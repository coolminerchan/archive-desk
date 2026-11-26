(() => {
  let serial = 0
  const pending = new Map(), listeners = new Set()
  window.chrome.webview.addEventListener('message', ({ data }) => {
    if (data.kind === 'result') {
      const resolve = pending.get(data.id)
      if (resolve) { pending.delete(data.id); resolve(data.value) }
    } else if (data.kind === 'event' && data.name === 'desktop:changed') {
      for (const listener of listeners) listener()
    }
  })
  Object.defineProperty(window, 'desktop', { value: Object.freeze({
    act(name, args) {
      const id = ++serial
      return new Promise(resolve => { pending.set(id, resolve); window.chrome.webview.postMessage({ kind: 'invoke', id, name, args }) })
    },
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener) }
  }) })
})()
