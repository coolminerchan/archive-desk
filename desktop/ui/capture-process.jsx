import React from 'react'
import { Panel } from './capture-ui.jsx'

export default function CaptureProcess() {
  return <Panel title="完整备份流程" description="先开始记录，再登录和浏览，最后保存并核对。" className="c-process" data-testid="capture-process">
    <ol className="c-process-steps">
      <li><span>1</span><div><h3>开始备份</h3><p>点击上方「开始备份」，按系统提示允许权限。等工具显示正在采集后，再进入游戏；首次找不到游戏时，选择一次官服程序。</p></div></li>
      <li><span>2</span><div><h3>登录自己的账号</h3><p>游戏会在采集就绪后打开。如果游戏原本已在运行，请返回登录界面重新登录一次，确保账号资料也被记录。</p></div></li>
      <li><span>3</span><div><h3>在游戏里依次浏览</h3><p>每次等页面或场景加载完，再切换下一项。无需等工具里的每项都变色。</p>
        <div className="c-process-browse">
          <div><strong>角色与背包</strong><p>打开角色、穿搭、背包和宠物仓库，切换分类并翻页。</p></div>
          <div><strong>全部装备</strong><p>武器、护甲、海报分别打开完整列表，切换筛选并翻页；只看身上穿戴的装备不够。</p></div>
          <div><strong>地图与探索</strong><p>打开各已解锁地区的探索、收集和月亮页面，再进入对应地区等待加载。水晶、宝箱、景点和挑战历史随返回内容保留。</p></div>
          <div><strong>星云树</strong><p>打开星云树，切换可见分区，等待激活节点、任务和领奖记录加载。不用重新激活或领奖。</p></div>
          <div><strong>生活职业</strong><p>分别查看烹饪、钓鱼、制作、手工艺、缝纫、采集的等级和技能。需要保留图鉴历史次数时，再打开各职业图鉴。</p></div>
          <div><strong>自己的家园</strong><p>进入自家，走到不同区域等待家具加载，按需切换预设。别人家的装修请使用左侧「家园装修」单独采集。</p></div>
          <div><strong>社交列表</strong><p>分别打开好友、好友申请、黑名单，等待各分类加载；不用添加或删除好友。</p></div>
          <div><strong>其他资料与副本</strong><p>打开邮件、成就分组、图鉴和档案。按需查看副本详情；需要副本内宝箱记录时，进入副本等待加载，无需重打。</p></div>
        </div>
      </div></li>
      <li><span>4</span><div><h3>结束并保存</h3><p>正常退出游戏，工具会自动整理；也可以点击「停止并保存」。等待整理完成，账号包默认保存在「文档 → 游戏账号备份」，可点「打开文件夹」查看。</p></div></li>
      <li><span>5</span><div><h3>查看结果，按缺项补充</h3><p>到「查看资料」分类查看，或在主页展开「核对采集内容」。旧包缺少展示时，先用「打开已有备份」重新解析；已有记录不用重复采集。确实缺少的内容，可另开一轮录制，重新登录后浏览对应页面。</p></div></li>
    </ol>
    <p className="c-process-note">抽卡历史无需操作。备份不要求升级、消耗道具、重新拾取水晶或重做挑战；单次记录也不代表全账号已经采齐。</p>
  </Panel>
}
