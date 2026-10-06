// 範例教學：每一課有目標、練習檔、操作步驟與「應該看到的結果」（由示範資料即時計算）
import { useMemo, useState, type ReactNode } from 'react';
import { SAMPLE_FILES, demoExpectations } from '../io/samples';
import { download } from './common';
import { fmtThousands } from '../core/units';

export interface GuideNav { tab: string; sub?: string }

interface Lesson {
  title: string;
  time: string;
  goal: string;
  files?: string[];
  steps: ReactNode[];
  expect?: ReactNode[];
  tips?: ReactNode[];
  go?: GuideNav & { label: string; demo?: boolean };
}

export function Guide(props: { onClose(): void; go(nav: GuideNav, demo: boolean): void }) {
  const [idx, setIdx] = useState(0);
  const e = useMemo(() => demoExpectations(), []);
  const n = (v: number, d = 0) => fmtThousands(v, d);
  const fileOf = (name: string) => SAMPLE_FILES.find(f => f.name === name)!;

  const lessons: Lesson[] = [
    {
      title: '開始之前', time: '2 分鐘',
      goal: '了解畫面配置、資料存在哪裡，並下載練習檔。',
      steps: [
        <>畫面分四區：上方是功能頁籤（依工作順序排列）、左側是該頁的設定、中間是平面圖、下方是資料表或斷面圖。</>,
        <>平面圖操作：<b>滾輪</b>縮放、<b>拖曳</b>平移、按 <kbd>F</kbd> 縮放到全圖；點測點可以看座標。<kbd>Ctrl</kbd>+<kbd>Z</kbd> 復原、<kbd>Ctrl</kbd>+<kbd>Y</kbd> 重做。</>,
        <>所有資料只存在你這台電腦的瀏覽器，不會上傳。換電腦或備份時，用「專案 → 下載專案檔」。</>,
        <>建議用電腦版 Chrome 或 Edge。下方的練習檔每一課都會用到，可以先全部下載。</>,
      ],
      files: SAMPLE_FILES.map(f => f.name),
    },
    {
      title: '第 1 課　看一遍示範資料', time: '5 分鐘',
      goal: '用內建的野溪示範工程，認識從測點到土方的完整成果。',
      go: { tab: 'project', label: '載入示範資料並開始', demo: true },
      steps: [
        <>按右邊的「載入示範資料並開始」，平面圖會出現測點、等高線、中心線與樁號。</>,
        <>在平面圖上滾輪放大，放到夠大時會出現每個點的高程。</>,
        <>按平面圖右上角的 <b>3D</b>，用左鍵旋轉、右鍵平移看地形；「垂直誇大」可以讓起伏更明顯。</>,
        <>依序點上方的「地形、方格土方、平曲線、縱斷面、橫斷面」看看各頁的成果。</>,
      ],
      expect: [
        <>測點 {n(e.points)} 點，其中 <b>{e.nullPts} 點無高程</b>（示範資料故意放的錯誤點，紅色圓點），不參與三角網。</>,
        <>三角網約 {n(e.tri)} 個三角形，高程 {e.zMin.toFixed(2)} ～ {e.zMax.toFixed(2)} m。</>,
        <>溪流水線當作斷線，三角網套用了 {e.breakEdges} 段斷線（「自動連線」頁可看到）。</>,
      ],
    },
    {
      title: '第 2 課　匯入點檔與高程檢查', time: '5 分鐘',
      goal: '匯入 CSV 點檔，找出並刪除高程錯誤的點，產生等高線。',
      files: ['範例1_測點.csv'],
      go: { tab: 'points', label: '前往「測點」頁' },
      steps: [
        <>「專案」頁按「新專案」（按兩次確認）。</>,
        <>到「測點」頁，欄位順序選「點號, E(X), N(Y), Z, 代碼」，按「匯入 CSV／TXT」選 <b>範例1_測點.csv</b>。標題列會自動略過。</>,
        <>看「高程檢查」：最後 3 點的高程是 0、-9999、空白，被判定為「無高程」，畫成紅點，不會進三角網。</>,
        <>按「刪除無高程點」清掉它們（或保留當作平面位置參考）。</>,
        <>到「地形」頁按「用測點外框」建立邊界，等高線就會出現；試著把首曲線間距改成 0.5 m。</>,
      ],
      expect: [<>匯入後「無高程（不建網）」為 3 點；刪除後為 0 點。</>],
      tips: [<>如果你的點檔是「點號, N, E, Z」（縱座標在前），匯入前改選對應的欄位順序，或匯入後用座標轉換修正。</>],
    },
    {
      title: '第 3 課　DXF 等高線圖轉測點', time: '5 分鐘',
      goal: '把 AutoCAD 的地形圖（等高線、高程點）轉成可以建三角網的測點。',
      files: ['範例2_地形等高線.dxf'],
      go: { tab: 'points', label: '前往「測點」頁' },
      steps: [
        <>新專案後，在「測點」頁按「匯入 DXF」選 <b>範例2_地形等高線.dxf</b>。</>,
        <>對話框左側列出 4 個圖層：<code>CONT1</code> 首曲線、<code>CONT5</code> 計曲線、<code>SPOT</code> 高程點、<code>FRAME</code> 圖框。</>,
        <>右側「預覽」會即時更新。把 <code>FRAME</code> 取消勾選，看「將匯入測點」的變化；再勾回來，注意圖框的頂點因高程為 0 被排除，(0,0) 角點也被當作飛點剔除。</>,
        <><code>SPOT</code> 的點位本身 Z = 0，旁邊寫著高程文字。「高程文字配對半徑」3 m 會把文字高程配給點位。</>,
        <>「沿線加密間距」設 5 m（等高線頂點太稀時補點），按「匯入」。到「地形」頁按「用測點外框」看重建的等高線。</>,
      ],
      expect: [<>預覽的高程範圍應在 {e.zMin.toFixed(0)} ～ {e.zMax.toFixed(0)} m 之間，不會出現 0 或 -9999。</>],
      tips: [<>DWG 檔請先在 AutoCAD 另存成 DXF（ASCII）。台灣常見的舊版 DXF 用 Big5 編碼，系統會自動判斷。</>],
    },
    {
      title: '第 4 課　外業手簿計算碎部點', time: '8 分鐘',
      goal: '由全站儀的觀測值（3DF）算出碎部點座標與高程，並處理轉站。',
      files: ['範例3_控制點.csv', '範例4_外業觀測.3df'],
      go: { tab: 'survey', sub: 'ctl', label: '前往「測量計算 → 控制點」' },
      steps: [
        <>新專案後到「測量計算 → 控制點」，按「匯入 CSV」選 <b>範例3_控制點.csv</b>，平面圖會出現 K1～K4 四個黃色三角形。</>,
        <>切到「觀測手簿」，按「匯入 3DF」選 <b>範例4_外業觀測.3df</b>。</>,
        <>上方顯示「2/2 站已算出」。第一站 K1 後視 K2；第二站架在 T1，T1 是在第一站觀測的<b>轉站點</b>（點名以英文字母開頭），算出後自動成為已知點。</>,
        <>下方左表是觀測值，右表是算出的座標。試著把某點的天頂距改一下，右表會立刻重算。</>,
        <>按「加入測點」把結果送到測點，再按「轉站點寫入控制點」保存 T1。</>,
      ],
      expect: [<>共算出 <b>{e.surveyPts} 點</b>（含轉站點 T1）。</>],
      tips: [<>覘標高填 0 的點只算平面位置、不算高程（屋頂、懸吊物）。觀測代碼填 <code>BS</code> 是自由測站、填 <code>99999.點名</code> 是前方交會。</>],
    },
    {
      title: '第 5 課　導線計算', time: '5 分鐘',
      goal: '以四已知點閉合導線檢核外業成果，並做閉合差平差。',
      go: { tab: 'survey', sub: 'trav', label: '載入示範資料並前往「導線」', demo: true },
      steps: [
        <>型態為「四已知點閉合導線」：起點 K1（後視 K2）、終點 K3（前視 K4）。</>,
        <>下方左表是導線手簿：每站的水平角（由後視順時針量到前視，ddd.mmss）與到下一站的距離。</>,
        <>右表是成果：改正後角度、方位角、座標改正數（mm）與平差後座標。平面圖會畫出黃色導線。</>,
        <>練習：把 T1 的角度從 <code>{e.travT1}</code> 改成 <code>{e.travT1Plus20}</code>（多 20″），看角度閉合差與精度怎麼變。</>,
        <>確認合格後按「導線點寫入控制點」，T1、T2 就能給其他計算使用。</>,
      ],
      expect: [<>角度閉合差約 {e.travAngle.toFixed(1)}″、閉合差 f 約 {(e.travF * 1000).toFixed(1)} mm、相對精度約 1 / {n(e.travPrecision)}。</>],
    },
    {
      title: '第 6 課　水準測量與縱斷面', time: '6 分鐘',
      goal: '計算直接水準（含樁號中間視），檢核閉合差，並把樁號高程用在縱斷面。',
      files: ['範例6_水準手簿.txt'],
      go: { tab: 'survey', sub: 'lev', label: '載入示範資料並前往「水準」', demo: true },
      steps: [
        <>示範資料已輸入水準手簿：由 K1 出發，沿中心線各樁號讀中間視，經轉點閉合到 K3。</>,
        <>想自己輸入時：用文字編輯器打開 <b>範例6_水準手簿.txt</b>，複製第 2 列以後的內容，點水準表第一格貼上，整張表會一次填好。</>,
        <>按「起終點高程取自控制點」，再選閉合差限度（例如土木工程 ±20√K mm）。</>,
        <>看「檢核」是否合格，再按「寫入縱斷面地面高」。</>,
        <>到「縱斷面」頁，「縱斷面地面高來源」已切換成水準成果；可以隨時切回三角網比較。</>,
      ],
      expect: [<>閉合差約 {(e.levF * 1000).toFixed(1)} mm，允許 ±{(e.levAllowed * 1000).toFixed(1)} mm，判定合格。</>],
    },
    {
      title: '第 7 課　自動連線成圖', time: '8 分鐘',
      goal: '依外業記錄的連線代碼，自動畫出房屋、道路、圍牆等地物。',
      files: ['範例5_連線碼測點.csv'],
      go: { tab: 'sam', label: '載入示範資料並前往「自動連線」', demo: true },
      steps: [
        <>示範資料南岸的農舍一帶都有連線碼。到「自動連線」頁看統計，平面圖放大到農舍附近。</>,
        <>對照下表理解代碼寫法：
          <table className="tbl compact guide-tbl">
            <tbody>
              <tr><td><code>RD1S</code>、<code>RD2S</code>…</td><td>兩條路邊線（線別 1、2）交錯施測，系統依線別分開連</td></tr>
              <tr><td><code>RD1L.E</code></td><td>路邊轉折點兼電力桿（共點用「.」）</td></tr>
              <tr><td><code>RD1M</code></td><td>三點弧中間點，和前後兩點畫成弧線</td></tr>
              <tr><td><code>BD1L..2R</code>、<code>BD1C</code></td><td>房屋轉折點並註記 2 樓；<code>C</code> 閉合回起點</td></tr>
              <tr><td><code>BD2X..1R</code></td><td>只測三個角，<code>X</code> 依直角自動補出第四角</td></tr>
              <tr><td><code>IC1O3</code></td><td>圓心點、半徑 3 m 的圓形花圃</td></tr>
              <tr><td><code>TR</code>、<code>F</code></td><td>獨立物：樹、消防栓</td></tr>
              <tr><td><code>RV1S</code>…<code>RV1E</code></td><td>溪流水線，圖例設為「斷線」，三角網不會跨過它</td></tr>
            </tbody>
          </table>
        </>,
        <>在下方圖例庫把「房屋」的顏色或 DXF 圖層改掉，平面圖立刻更新。</>,
        <>也可以新專案後匯入 <b>範例5_連線碼測點.csv</b>，只看地物的成圖結果。</>,
      ],
      expect: [<>畫出 {e.samLines} 條地物線（溪流、兩條路邊、兩棟房屋、圍牆）、{e.samSymbols} 個獨立物符號、1 個圓；代碼錯誤 0 個。</>],
      tips: [<>測點的處理順序就是匯入順序，也就是外業的施測順序，所以點檔請不要重新排序。</>],
    },
    {
      title: '第 8 課　方格法整地土方', time: '4 分鐘',
      goal: '計算整地到設計高程的挖填方量。',
      go: { tab: 'grid', label: '載入示範資料並前往「方格土方」', demo: true },
      steps: [
        <>計算範圍是「地形」頁的邊界（黃色虛線）。</>,
        <>方格邊長 10 m、設計面選「水平面」、設計高程 {e.gridZ} m，按「計算土方」。</>,
        <>平面圖上紅色是挖方、藍色是填方，顏色越深挖填越多；下方表格列出每格四個角點的挖填高。</>,
        <>試著把方格邊長改成 5 m 再算一次：方格越小越接近實際地形。</>,
        <>按「匯出計算表 CSV」用 Excel 打開檢查。</>,
      ],
      expect: [<>挖方約 {n(e.gridCut)} m³、填方約 {n(e.gridFill)} m³（10 m 方格）。</>],
    },
    {
      title: '第 9 課　道路設計與斷面土方', time: '10 分鐘',
      goal: '由平曲線、縱斷面到橫斷面，算出沿線的挖填土方。',
      go: { tab: 'alignment', label: '載入示範資料並前往「平曲線」', demo: true },
      steps: [
        <><b>平曲線</b>：座標法表格中 IP1、IP2 各給了半徑 R。把 IP1 的 R 從 80 改成 60，看曲線資料表與樁號怎麼變（T、L、E 自動重算）。</>,
        <>要練偏角法，切到「偏角法」，表格會換算成方位角／偏角與距離，可以改完再「計算並套用」。</>,
        <><b>縱斷面</b>：下方圖中綠線是原地面、橘線是設計線；在圖上點一下可選取樁號。VPI1 設了 60 m 的豎曲線。</>,
        <><b>橫斷面</b>：用「上一樁／下一樁」逐樁檢查。把挖方邊坡從 1:0.5 改成 1:1，看斷面與土方的變化。</>,
        <>下方土石方數量表是平均斷面法：V = (A₁ + A₂) / 2 × L，最右欄是累積土方（正為餘土）。</>,
      ],
      expect: [<>中心線全長約 {e.alLength.toFixed(1)} m、{e.curves} 個平曲線、{e.stakes} 個樁號；總挖方約 {n(e.cut)} m³、總填方約 {n(e.fill)} m³。</>],
    },
    {
      title: '第 10 課　匯出與備份', time: '3 分鐘',
      goal: '把成果帶到 AutoCAD 與 Excel，並備份專案。',
      go: { tab: 'export', label: '前往「匯出」頁' },
      steps: [
        <>「匯出」頁勾選要的圖層，按「下載 DXF」。檔案是 AutoCAD R12 格式，任何版本都能開，各類圖元分在不同圖層（例如 <code>CONT1</code>、<code>CONT5</code>、<code>SAM_BLDG</code>、<code>STAKE</code>）。</>,
        <>報表 CSV 帶有工程名稱等抬頭，Excel 直接開啟不會亂碼。</>,
        <>最後按「下載專案檔」備份。之後在任何電腦用「專案 → 開啟專案檔」就能接著做。</>,
      ],
    },
    {
      title: '常見問題', time: '',
      goal: '使用時最常遇到的狀況。',
      steps: [
        <><b>三角網拉出很長的三角形？</b> 到「地形」頁設定最大邊長，或畫邊界。地形線（坎、溝）用自動連線碼記錄並在圖例設為「斷線」，三角網就不會跨過去。</>,
        <><b>等高線或土方數字異常大？</b> 先看「測點 → 高程檢查」有沒有高程 0 或 -9999 的點。</>,
        <><b>角度怎麼輸入？</b> 一律用 ddd.mmss，例如 <code>13.0257</code> 是 13°02′57″。</>,
        <><b>DXF 讀不到？</b> 只支援 ASCII 格式的 DXF；DWG 或二進位 DXF 請先在 AutoCAD 另存。</>,
        <><b>資料不見了？</b> 清除瀏覽器資料會刪掉本機專案，請定期下載專案檔備份。</>,
        <><b>座標是 TWD67 或假設座標？</b> 用「測量計算 → 座標轉換」，輸入兩個以上對應點即可整批轉換。</>,
      ],
    },
  ];

  const L = lessons[idx];
  return (
    <div className="guide-back" role="dialog" aria-modal="true" aria-labelledby="guide-title">
      <div className="guide">
        <header className="guide-head">
          <h2 id="guide-title">範例教學</h2>
          <span className="muted">跟著做一遍，大約 1 小時可以熟悉全部功能</span>
          <button type="button" className="icon-btn" onClick={props.onClose} aria-label="關閉教學">✕</button>
        </header>
        <div className="guide-body">
          <nav className="guide-nav" aria-label="課程">
            {lessons.map((l, i) => (
              <button key={i} type="button" className={i === idx ? 'on' : ''} onClick={() => setIdx(i)}>
                <span>{l.title}</span>{l.time && <span className="muted small">{l.time}</span>}
              </button>
            ))}
          </nav>
          <article className="guide-main">
            <h3>{L.title}</h3>
            <p className="guide-goal">{L.goal}</p>
            {L.files && (
              <section>
                <h4>練習檔</h4>
                <div className="guide-files">
                  {L.files.map(name => {
                    const f = fileOf(name);
                    return (
                      <div key={name} className="guide-file">
                        <button type="button" className="btn" onClick={() => download(f.name, f.make(), f.mime)}>下載 {f.name}</button>
                        <span className="muted small">{f.desc}</span>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
            <section>
              <h4>操作步驟</h4>
              <ol className="guide-steps">{L.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
            </section>
            {L.expect && (
              <section className="guide-expect">
                <h4>應該看到的結果</h4>
                <ul>{L.expect.map((s, i) => <li key={i}>{s}</li>)}</ul>
              </section>
            )}
            {L.tips && <section className="guide-tips">{L.tips.map((s, i) => <p key={i}>💡 {s}</p>)}</section>}
            <footer className="guide-foot">
              <button type="button" className="btn" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>◀ 上一課</button>
              {L.go && <button type="button" className="btn primary" onClick={() => props.go(L.go!, !!L.go!.demo)}>{L.go.label}</button>}
              <button type="button" className="btn" disabled={idx === lessons.length - 1} onClick={() => setIdx(idx + 1)}>下一課 ▶</button>
            </footer>
          </article>
        </div>
      </div>
    </div>
  );
}
