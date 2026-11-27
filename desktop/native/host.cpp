#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <dwmapi.h>
#include <shlobj.h>
#include <shlwapi.h>
#include <shellapi.h>
#include <wrl.h>
#include <WebView2.h>
#include <filesystem>
#include <fstream>
#include <thread>
#include <mutex>
#include <string>
#include <vector>
#include <stdexcept>
#include "json.hpp"

using Microsoft::WRL::ComPtr;
using Microsoft::WRL::Callback;
using json = nlohmann::ordered_json;
namespace fs = std::filesystem;
constexpr UINT NODE_MESSAGE = WM_APP + 1, NODE_EXIT = WM_APP + 2;
HWND windowHandle;
HANDLE inputHandle = nullptr, nodeProcess = nullptr;
ComPtr<ICoreWebView2Controller> controller;
ComPtr<ICoreWebView2> view;
ComPtr<IFileDialog> activeDialog;
fs::path root, appDirectory, dataDirectory, logFile;
json product, fixture;
std::mutex writeMutex, logMutex;
bool closing = false, testing = false, testStarted = false, autoCapture = false;
void recordTest(bool success, const std::string& error);
int resultCode = 0;
size_t dialogIndex = 0;

std::wstring wide(const std::string& text) {
    if (text.empty()) return {};
    int count = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(), (int)text.size(), nullptr, 0);
    if (!count) throw std::runtime_error("Invalid UTF-8");
    std::wstring value(count, 0);
    MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(), (int)text.size(), value.data(), count);
    return value;
}
std::string utf8(const std::wstring& text) {
    int count = WideCharToMultiByte(CP_UTF8, 0, text.data(), (int)text.size(), nullptr, 0, nullptr, nullptr);
    std::string value(count, 0);
    WideCharToMultiByte(CP_UTF8, 0, text.data(), (int)text.size(), value.data(), count, nullptr, nullptr);
    return value;
}
std::string readFile(const fs::path& path, size_t limit = 16 * 1024 * 1024) {
    if (fs::file_size(path) > limit) throw std::runtime_error("File exceeds read budget");
    std::ifstream file(path, std::ios::binary);
    if (!file) throw std::runtime_error("Could not read application file");
    return std::string(std::istreambuf_iterator<char>(file), {});
}
void logText(const std::string& text) {
    std::lock_guard<std::mutex> lock(logMutex);
    std::ofstream file(logFile, std::ios::app | std::ios::binary); file << text << '\n';
}
void writeNode(const json& value) {
    std::lock_guard<std::mutex> lock(writeMutex);
    if (!inputHandle) return;
    auto line = value.dump() + "\n";
    size_t offset = 0;
    while (offset < line.size()) {
        DWORD written = 0;
        if (!WriteFile(inputHandle, line.data() + offset, (DWORD)(line.size() - offset), &written, nullptr) || !written) break;
        offset += written;
    }
}
void closeApp() {
    if (!closing) {
        closing = true;
        if (activeDialog) activeDialog->Close(HRESULT_FROM_WIN32(ERROR_CANCELLED));
        writeNode({{"kind", "close"}});
    }
}
void fail(const std::string& message) {
    logText(message); resultCode = 1;
    if (testing) { recordTest(false, message); closeApp(); if (!nodeProcess) DestroyWindow(windowHandle); return; }
    MessageBoxW(windowHandle, wide(message).c_str(), L"启动提示", MB_OK | MB_ICONERROR);
    closeApp();
    if (!nodeProcess) DestroyWindow(windowHandle);
}
void recordTest(bool success, const std::string& error) {
    if (!testing) return;
    json result = {{"success", success}, {"error", error}, {"role", product["role"]}, {"executable_root", utf8(root.wstring())}};
    fs::path output = wide(fixture.value("result", ""));
    if (!output.empty()) { std::ofstream file(output); file << result.dump(2); }
    if (!success) resultCode = 1;
}
void finishTest(const json& message) {
    bool success = message.value("success", false);
    recordTest(success, message.value("error", ""));
    auto path = wide(fixture.value("screenshot", ""));
    if (path.empty()) { closeApp(); return; }
    SetTimer(windowHandle, 40, 12000, nullptr);
    ComPtr<IStream> stream;
    HRESULT hr = SHCreateStreamOnFileEx(path.c_str(), STGM_CREATE | STGM_WRITE | STGM_SHARE_EXCLUSIVE, FILE_ATTRIBUTE_NORMAL, TRUE, nullptr, &stream);
    if (FAILED(hr)) { recordTest(false, "Could not create preview file"); closeApp(); return; }
    HRESULT capture = view->CapturePreview(COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG, stream.Get(),
      Callback<ICoreWebView2CapturePreviewCompletedHandler>([stream](HRESULT hr) -> HRESULT {
        KillTimer(windowHandle, 40);
        if (FAILED(hr)) recordTest(false, "Could not capture preview");
        closeApp(); return S_OK;
      }).Get());
    if (FAILED(capture)) { recordTest(false, "Preview could not start"); closeApp(); }
}
json showDialog(const std::string& method, const json& options) {
    if (testing) {
        if (dialogIndex >= fixture["dialogs"].size()) throw std::runtime_error("Unexpected file dialog in native test");
        auto selected = fixture["dialogs"][dialogIndex++];
        if (selected.is_null()) return {{"canceled", true}, {"filePaths", json::array()}};
        std::string path = selected.get<std::string>();
        return method == "save-dialog" ? json{{"canceled", false}, {"filePath", path}} : json{{"canceled", false}, {"filePaths", json::array({path})}};
    }
    bool save = method == "save-dialog";
    ComPtr<IFileDialog> dialog;
    HRESULT hr = CoCreateInstance(save ? CLSID_FileSaveDialog : CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&dialog));
    if (FAILED(hr)) throw std::runtime_error("无法打开文件选择窗口");
    bool folder = false;
    if (options.contains("properties")) for (const auto& property : options["properties"]) if (property == "openDirectory") folder = true;
    FILEOPENDIALOGOPTIONS flags;
    dialog->GetOptions(&flags);
    flags |= FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST;
    if (folder) flags |= FOS_PICKFOLDERS;
    else if (!save) flags |= FOS_FILEMUSTEXIST;
    dialog->SetOptions(flags);
    auto title = wide(options.value("title", folder ? "选择目录" : save ? "保存文件" : "选择文件"));
    dialog->SetTitle(title.c_str());
    std::vector<std::wstring> names, patterns;
    std::vector<COMDLG_FILTERSPEC> specs;
    if (!folder && options.contains("filters")) {
        for (const auto& filter : options["filters"]) {
            names.push_back(wide(filter.value("name", "文件")));
            std::wstring pattern;
            for (const auto& extension : filter["extensions"]) { if (!pattern.empty()) pattern += L";"; pattern += L"*." + wide(extension.get<std::string>()); }
            patterns.push_back(pattern);
        }
        for (size_t i = 0; i < names.size(); ++i) specs.push_back({names[i].c_str(), patterns[i].c_str()});
        if (!specs.empty()) dialog->SetFileTypes((UINT)specs.size(), specs.data());
    }
    if (options.contains("defaultPath") && options["defaultPath"].is_string()) {
        fs::path path = wide(options["defaultPath"].get<std::string>());
        if (save) dialog->SetFileName(path.filename().c_str());
        auto parent = fs::is_directory(path) ? path : path.parent_path();
        if (!parent.empty() && fs::is_directory(parent)) {
            ComPtr<IShellItem> item;
            if (SUCCEEDED(SHCreateItemFromParsingName(parent.c_str(), nullptr, IID_PPV_ARGS(&item)))) dialog->SetFolder(item.Get());
        }
    }
    activeDialog = dialog;
    hr = dialog->Show(windowHandle);
    activeDialog.Reset();
    if (hr == HRESULT_FROM_WIN32(ERROR_CANCELLED)) return {{"canceled", true}, {"filePaths", json::array()}};
    if (FAILED(hr)) throw std::runtime_error("文件选择失败");
    ComPtr<IShellItem> item; dialog->GetResult(&item);
    PWSTR path = nullptr; item->GetDisplayName(SIGDN_FILESYSPATH, &path);
    std::string value = utf8(path); CoTaskMemFree(path);
    return save ? json{{"canceled", false}, {"filePath", value}} : json{{"canceled", false}, {"filePaths", json::array({value})}};
}
void nodeMessage(const json& message) {
    std::string kind = message.value("kind", "");
    if (kind == "ready") {
        std::wstring url = L"https://app.local/index.html?role=" + wide(product["role"]);
        url += L"&v=" + wide(product.value("version", ""));
        if (autoCapture && product["role"] == "capture") url += L"&autoCapture=1";
        view->Navigate(url.c_str());
    } else if (kind == "result" || kind == "event") {
        if (view) view->PostWebMessageAsJson(wide(message.dump()).c_str());
    } else if (kind == "quit") {
        closing = true; DestroyWindow(windowHandle);
    } else if (kind == "host") {
        try {
            std::string method = message.value("method", "");
            json value;
            if (method == "open-dialog" || method == "save-dialog") value = showDialog(method, message["value"]);
            else if (method == "elevate-capture") {
                if (product["role"] != "capture" || closing) throw std::runtime_error("当前窗口不支持采集权限请求");
                wchar_t executable[32768]; GetModuleFileNameW(nullptr, executable, 32768);
                SHELLEXECUTEINFOW launch = {sizeof(launch)};
                launch.fMask = SEE_MASK_NOCLOSEPROCESS; launch.hwnd = windowHandle;
                launch.lpVerb = L"runas"; launch.lpFile = executable;
                launch.lpParameters = L"--one-click"; launch.lpDirectory = root.c_str(); launch.nShow = SW_SHOWNORMAL;
                if (!ShellExecuteExW(&launch)) throw std::runtime_error(GetLastError() == ERROR_CANCELLED ? "已取消系统权限确认，尚未开始采集。" : "无法请求采集权限，请右键以管理员身份运行。");
                if (launch.hProcess) CloseHandle(launch.hProcess);
                value = true;
                PostMessageW(windowHandle, WM_CLOSE, 0, 0);
            }
            else if (method == "open-path" || method == "open-external") {
                std::string target = message["value"];
                if (method == "open-external" && target.rfind("https://", 0) != 0 && target.rfind("steam://rungameid/", 0) != 0)
                    throw std::runtime_error("不支持的链接类型");
                if (method == "open-path" && !fs::path(wide(target)).is_absolute()) throw std::runtime_error("路径必须为绝对路径");
                auto result = (INT_PTR)ShellExecuteW(windowHandle, L"open", wide(target).c_str(), nullptr, nullptr, SW_SHOWNORMAL);
                if (result <= 32) throw std::runtime_error("无法打开所选位置");
                value = "";
            } else throw std::runtime_error("不支持的窗口操作");
            writeNode({{"kind", "host-result"}, {"id", message["id"]}, {"value", value}});
        } catch (const std::exception& error) { writeNode({{"kind", "host-result"}, {"id", message["id"]}, {"error", error.what()}}); }
    }
}
void createView() {
    auto profile = dataDirectory / L"web-profile";
    HRESULT hr = CreateCoreWebView2EnvironmentWithOptions(nullptr, profile.c_str(), nullptr,
      Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>([](HRESULT hr, ICoreWebView2Environment* environment) -> HRESULT {
        if (FAILED(hr)) { fail("无法创建显示组件，请检查系统网页组件是否可用。"); return S_OK; }
        environment->CreateCoreWebView2Controller(windowHandle,
          Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>([](HRESULT hr, ICoreWebView2Controller* value) -> HRESULT {
            if (FAILED(hr)) { fail("无法创建程序窗口。"); return S_OK; }
            controller = value; controller->get_CoreWebView2(&view);
            RECT bounds; GetClientRect(windowHandle, &bounds); controller->put_Bounds(bounds);
            ComPtr<ICoreWebView2Controller2> controller2;
            if (SUCCEEDED(controller.As(&controller2))) controller2->put_DefaultBackgroundColor({255, 19, 20, 25});
            ComPtr<ICoreWebView2Settings> settings; view->get_Settings(&settings);
            settings->put_AreDevToolsEnabled(FALSE); settings->put_AreDefaultContextMenusEnabled(FALSE);
            settings->put_IsStatusBarEnabled(FALSE); settings->put_AreHostObjectsAllowed(FALSE);
            ComPtr<ICoreWebView2_3> mapping;
            if (FAILED(view.As(&mapping))) { fail("系统网页组件版本过旧，请先更新。"); return S_OK; }
            mapping->SetVirtualHostNameToFolderMapping(L"app.local", (appDirectory / L"rendered").c_str(), COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY_CORS);
            view->AddScriptToExecuteOnDocumentCreated(wide(readFile(appDirectory / L"native-bridge.js")).c_str(), nullptr);
            EventRegistrationToken token;
            view->add_NavigationStarting(Callback<ICoreWebView2NavigationStartingEventHandler>([](ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* args) -> HRESULT {
                PWSTR uri = nullptr; args->get_Uri(&uri); std::wstring value = uri ? uri : L""; CoTaskMemFree(uri);
                if (value.rfind(L"https://app.local/", 0) != 0) args->put_Cancel(TRUE);
                return S_OK;
            }).Get(), &token);
            view->add_NewWindowRequested(Callback<ICoreWebView2NewWindowRequestedEventHandler>([](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT { args->put_Handled(TRUE); return S_OK; }).Get(), &token);
            view->add_PermissionRequested(Callback<ICoreWebView2PermissionRequestedEventHandler>([](ICoreWebView2*, ICoreWebView2PermissionRequestedEventArgs* args) -> HRESULT { args->put_State(COREWEBVIEW2_PERMISSION_STATE_DENY); return S_OK; }).Get(), &token);
            view->add_WebMessageReceived(Callback<ICoreWebView2WebMessageReceivedEventHandler>([](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
                PWSTR origin = nullptr; args->get_Source(&origin);
                bool trusted = origin && std::wstring(origin).rfind(L"https://app.local/", 0) == 0; CoTaskMemFree(origin);
                if (!trusted) return S_OK;
                PWSTR raw = nullptr; args->get_WebMessageAsJson(&raw);
                try {
                    auto message = json::parse(utf8(raw));
                    if (message.value("kind", "") == "invoke") writeNode(message);
                    else if (testing && message.value("kind", "") == "test-done") finishTest(message);
                } catch (const std::exception& error) { logText(error.what()); }
                CoTaskMemFree(raw); return S_OK;
            }).Get(), &token);
            view->add_NavigationCompleted(Callback<ICoreWebView2NavigationCompletedEventHandler>([](ICoreWebView2*, ICoreWebView2NavigationCompletedEventArgs* args) -> HRESULT {
                BOOL success; args->get_IsSuccess(&success);
                if (!success) { fail("界面加载失败，请重新完整解压程序。"); return S_OK; }
                if (testing && !testStarted) {
                    testStarted = true;
                    auto source = "window.__fixture=" + fixture.dump() + ";\n" + readFile(wide(fixture.value("script", "")));
                    view->ExecuteScript(wide(source).c_str(), nullptr);
                }
                return S_OK;
            }).Get(), &token);
            // The backend starts only after the local renderer bridge is ready.
            PostMessageW(windowHandle, WM_APP + 3, 0, 0);
            return S_OK;
          }).Get());
        return S_OK;
      }).Get());
    if (FAILED(hr)) fail("显示组件启动失败。");
}
std::wstring quote(const std::wstring& value) {
    std::wstring result = L"\""; size_t slashes = 0;
    for (wchar_t ch : value) {
        if (ch == L'\\') { ++slashes; continue; }
        if (ch == L'"') result.append(slashes * 2 + 1, L'\\'); else result.append(slashes, L'\\');
        slashes = 0; result += ch;
    }
    result.append(slashes * 2, L'\\'); return result + L"\"";
}
bool recoverUpdate(const fs::path& base) {
    auto journalPath = root / L".capture-update.json";
    if (!fs::is_regular_file(journalPath)) return false;
    auto journal = json::parse(readFile(journalPath, 4 * 1024 * 1024));
    if (journal.value("kind", "") != "capture_update" ||
        (journal.value("phase", "") != "applying" && journal.value("phase", "") != "preparing")) return false;
    if (_wcsicmp(wide(journal.value("target", "")).c_str(), root.c_str()) != 0) throw std::runtime_error("更新恢复路径无效。");
    fs::path helper = wide(journal.value("helper", ""));
    auto expected = base / L"OverField Desktop/capture/updates";
    auto name = helper.filename().wstring();
    if (_wcsicmp(helper.parent_path().lexically_normal().c_str(), expected.lexically_normal().c_str()) != 0 ||
        name.size() != 38 || name.substr(0, 6) != L"apply-" || name.substr(6).find_first_not_of(L"0123456789abcdef") != std::wstring::npos ||
        !fs::is_regular_file(helper / L"node.exe") || !fs::is_regular_file(helper / L"capture-update-apply.mjs") ||
        (GetFileAttributesW(helper.c_str()) & FILE_ATTRIBUTE_REPARSE_POINT)) throw std::runtime_error("更新助手不可用，请从保留的旧版程序目录恢复。");
    DWORD helperPid = journal.value("helper_pid", 0u);
    if (helperPid) {
        HANDLE active = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, helperPid);
        if (active) {
            wchar_t image[32768]; DWORD length = 32768, code = 0;
            bool running = GetExitCodeProcess(active, &code) && code == STILL_ACTIVE &&
                QueryFullProcessImageNameW(active, 0, image, &length) && _wcsicmp(image, (helper / L"node.exe").c_str()) == 0;
            CloseHandle(active); if (running) return true;
        }
    }
    auto id = journal.value("id", "");
    if (id.size() != 32 || id.find_first_not_of("0123456789abcdef") != std::string::npos) throw std::runtime_error("更新事务编号无效。");
    SECURITY_ATTRIBUTES mutexAttributes = {sizeof(mutexAttributes), nullptr, TRUE};
    SetLastError(ERROR_SUCCESS);
    HANDLE recovery = CreateMutexW(&mutexAttributes, FALSE, (L"Local\\ArchiveDeskCaptureRecovery_" + wide(id)).c_str());
    if (!recovery) throw std::runtime_error("无法锁定更新恢复任务。");
    if (GetLastError() == ERROR_ALREADY_EXISTS) { CloseHandle(recovery); return true; }
    SetEnvironmentVariableW(L"NODE_OPTIONS", nullptr);
    auto arguments = quote((helper / L"node.exe").wstring()) + L" " + quote((helper / L"capture-update-apply.mjs").wstring()) +
        L" --recover " + quote(journalPath.wstring()) + L" " + std::to_wstring(GetCurrentProcessId());
    STARTUPINFOW startup = {}; startup.cb = sizeof(startup); PROCESS_INFORMATION process = {};
    if (!CreateProcessW((helper / L"node.exe").c_str(), arguments.data(), nullptr, nullptr, TRUE, CREATE_NO_WINDOW,
        nullptr, helper.c_str(), &startup, &process)) { CloseHandle(recovery); throw std::runtime_error("无法启动更新恢复助手。"); }
    CloseHandle(recovery); CloseHandle(process.hThread); CloseHandle(process.hProcess); return true;
}
void startNode() {
    SECURITY_ATTRIBUTES attributes = {sizeof(attributes), nullptr, TRUE};
    HANDLE outRead, outWrite, inRead, errRead, errWrite;
    if (!CreatePipe(&outRead, &outWrite, &attributes, 0) || !CreatePipe(&inRead, &inputHandle, &attributes, 0) || !CreatePipe(&errRead, &errWrite, &attributes, 0)) throw std::runtime_error("Could not create private process pipes");
    SetHandleInformation(outRead, HANDLE_FLAG_INHERIT, 0); SetHandleInformation(inputHandle, HANDLE_FLAG_INHERIT, 0); SetHandleInformation(errRead, HANDLE_FLAG_INHERIT, 0);
    SetEnvironmentVariableW(L"OVERFIELD_NATIVE_BRIDGE", L"1");
    SetEnvironmentVariableW(L"OVERFIELD_APP_DATA", dataDirectory.parent_path().parent_path().c_str());
    PWSTR documents = nullptr;
    if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_Documents, 0, nullptr, &documents))) {
        auto folder = testing && fixture.contains("documents") ? wide(fixture["documents"]) : std::wstring(documents);
        SetEnvironmentVariableW(L"OVERFIELD_DOCUMENTS", folder.c_str()); CoTaskMemFree(documents);
    }
    SetEnvironmentVariableW(L"NODE_OPTIONS", nullptr);
    std::wstring arguments = quote((root / L"runtime/node.exe").wstring()) + L" " + quote((appDirectory / L"main.mjs").wstring()) + L" --role=" + wide(product["role"]);
    STARTUPINFOW startup = {}; startup.cb = sizeof(startup); startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdInput = inRead; startup.hStdOutput = outWrite; startup.hStdError = errWrite;
    PROCESS_INFORMATION process = {};
    BOOL ok = CreateProcessW((root / L"runtime/node.exe").c_str(), arguments.data(), nullptr, nullptr, TRUE, CREATE_NO_WINDOW, nullptr, root.c_str(), &startup, &process);
    CloseHandle(inRead); CloseHandle(outWrite); CloseHandle(errWrite);
    if (!ok) throw std::runtime_error("后台组件启动失败，请重新完整解压程序。");
    nodeProcess = process.hProcess; CloseHandle(process.hThread);
    std::thread([outRead]() {
        char buffer[8192]; DWORD read; std::string pending;
        while (ReadFile(outRead, buffer, sizeof(buffer), &read, nullptr) && read) {
            pending.append(buffer, read);
            if (pending.size() > 16 * 1024 * 1024) break;
            size_t newline;
            while ((newline = pending.find('\n')) != std::string::npos) {
                auto line = pending.substr(0, newline); pending.erase(0, newline + 1);
                try { auto value = new json(json::parse(line)); if (!PostMessageW(windowHandle, NODE_MESSAGE, 0, (LPARAM)value)) delete value; }
                catch (const std::exception& error) { logText(error.what()); }
            }
        }
        CloseHandle(outRead); WaitForSingleObject(nodeProcess, INFINITE);
        DWORD code; GetExitCodeProcess(nodeProcess, &code); PostMessageW(windowHandle, NODE_EXIT, code, 0);
    }).detach();
    std::thread([errRead]() { char buffer[4096]; DWORD read; while (ReadFile(errRead, buffer, sizeof(buffer), &read, nullptr) && read) logText(std::string(buffer, read)); CloseHandle(errRead); }).detach();
}
LRESULT CALLBACK procedure(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
    try {
        switch (message) {
        case WM_SIZE: if (controller) { RECT bounds; GetClientRect(hwnd, &bounds); controller->put_Bounds(bounds); } return 0;
        case WM_GETMINMAXINFO: { auto info = (MINMAXINFO*)lParam; info->ptMinTrackSize = {1000, 700}; return 0; }
        case WM_APP + 3: startNode(); return 0;
        case NODE_MESSAGE: { std::unique_ptr<json> value((json*)lParam); nodeMessage(*value); return 0; }
        case NODE_EXIT: if (!closing && wParam) fail("后台组件意外退出，诊断信息已写入日志。"); resultCode = resultCode || (int)wParam; DestroyWindow(hwnd); return 0;
        case WM_CLOSE: if (!nodeProcess) DestroyWindow(hwnd); else closeApp(); return 0;
        case WM_TIMER: if (wParam == 40) { KillTimer(hwnd, 40); recordTest(false, "Preview capture timed out"); closeApp(); } return 0;
        case WM_DESTROY: if (controller) controller->Close(); view.Reset(); controller.Reset(); PostQuitMessage(resultCode); return 0;
        }
    } catch (const std::exception& error) { fail(error.what()); }
    return DefWindowProcW(hwnd, message, wParam, lParam);
}
int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int show) {
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    try {
        wchar_t module[32768]; GetModuleFileNameW(nullptr, module, 32768); root = fs::path(module).parent_path();
#ifdef OVERFIELD_TEST_HOST
        wchar_t reviewFixture[32768];
        if (GetEnvironmentVariableW(L"OVERFIELD_REVIEW_FIXTURE", reviewFixture, 32768)) { fixture = json::parse(readFile(reviewFixture)); testing = true; }
#endif
        wchar_t launchCwd[32768];
        if (GetCurrentDirectoryW(32768, launchCwd)) SetEnvironmentVariableW(L"OVERFIELD_CAPTURE_LAUNCH_CWD", launchCwd);
        PWSTR recoveryAppData = nullptr;
        if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_RoamingAppData, 0, nullptr, &recoveryAppData))) {
            fs::path recoveryBase = recoveryAppData; CoTaskMemFree(recoveryAppData);
            if (testing && fixture.contains("appData")) recoveryBase = wide(fixture["appData"]);
            if (recoverUpdate(recoveryBase)) { CoUninitialize(); return 0; }
        }
        appDirectory = root / L"resources/app";
        product = json::parse(readFile(appDirectory / L"product.json", 4096));
        std::string role = product.value("role", "");
        if (role != "server" && role != "client" && role != "capture") throw std::runtime_error("工具类型无效");
        SetCurrentProcessExplicitAppUserModelID((L"cn.overfield." + wide(role)).c_str());
        int argc; auto argv = CommandLineToArgvW(GetCommandLineW(), &argc);
        for (int i = 1; i < argc; ++i) if (std::wstring(argv[i]) == L"--one-click" && role == "capture") autoCapture = true;
#ifdef OVERFIELD_TEST_HOST
        for (int i = 1; i + 1 < argc; ++i) if (std::wstring(argv[i]) == L"--test-fixture") { fixture = json::parse(readFile(argv[++i])); testing = true; }
#endif
        LocalFree(argv);
        PWSTR appData; SHGetKnownFolderPath(FOLDERID_RoamingAppData, 0, nullptr, &appData);
        fs::path base = testing ? fs::path(wide(fixture.value("appData", ""))) : fs::path(appData); CoTaskMemFree(appData);
        dataDirectory = base / L"OverField Desktop" / wide(role); fs::create_directories(dataDirectory); logFile = dataDirectory / L"startup-native.log";
        if (!fs::is_regular_file(root / L"runtime/node.exe") || !fs::is_regular_file(appDirectory / L"rendered/index.html")) throw std::runtime_error("程序文件不完整，请完整解压本工具。");
        PWSTR version = nullptr; HRESULT available = GetAvailableCoreWebView2BrowserVersionString(nullptr, &version); CoTaskMemFree(version);
        if (FAILED(available)) throw std::runtime_error("缺少系统网页组件。请先安装 Microsoft Edge WebView2 Runtime，再启动本工具。下载地址见使用说明。");
        WNDCLASSW type = {}; type.hInstance = instance; type.lpfnWndProc = procedure; type.lpszClassName = L"OverFieldNative";
        type.hCursor = LoadCursor(nullptr, IDC_ARROW); type.hbrBackground = CreateSolidBrush(RGB(19,20,25)); type.hIcon = LoadIcon(instance, MAKEINTRESOURCE(101));
        RegisterClassW(&type);
        UINT dpi = GetDpiForSystem(); int width = MulDiv(1180, dpi, 96), height = MulDiv(800, dpi, 96);
        windowHandle = CreateWindowExW(0, type.lpszClassName, wide(product.value("name", "工具")).c_str(), WS_OVERLAPPEDWINDOW,
            CW_USEDEFAULT, CW_USEDEFAULT, width, height, nullptr, nullptr, instance, nullptr);
        BOOL dark = TRUE; DwmSetWindowAttribute(windowHandle, 20, &dark, sizeof(dark));
        COLORREF color = RGB(19,20,25); DwmSetWindowAttribute(windowHandle, 35, &color, sizeof(color));
        ShowWindow(windowHandle, testing ? SW_SHOWNORMAL : show);
        if (testing) ShowWindow(windowHandle, SW_SHOW);
        UpdateWindow(windowHandle); createView();
        MSG message; while (GetMessageW(&message, nullptr, 0, 0) > 0) { TranslateMessage(&message); DispatchMessageW(&message); }
        if (inputHandle) CloseHandle(inputHandle);
        CoUninitialize(); return resultCode;
    } catch (const std::exception& error) {
        std::wstring message = L"启动失败，请完整解压本工具后重试。";
        try { message = wide(error.what()); } catch (...) {}
        MessageBoxW(nullptr, message.c_str(), L"启动提示", MB_OK | MB_ICONERROR); CoUninitialize(); return 1;
    }
}
