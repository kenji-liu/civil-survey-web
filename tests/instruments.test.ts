import { describe, it, expect } from 'vitest';
import { parseInstrument, detectFormat } from '../src/io/instruments';
import { dmsToDeg } from '../src/core/units';

// 以下樣本取自手冊第三章「各廠牌全站式經緯儀資料格式_附件」
const GEODIMETER = `50=WL1234
2=A142 3=1.471
62=A141 21=0.0000
4=6 5=1 6=1.900 7=218.3349 8=98.2330 9=100.91
4=113 5=2 6=3.310 7=219.1422 8=97.4201 9=105.47
4=11 5=3 6=3.310 7=220.2758 8=97.3536 9=98.70`;

const LEICA = `110001+000000B1 21.124+31519290 22.104+08935550 31...0+00013045
51..0.+0000+000 87..00+00001500 88..00+00001500
110002+000000D1 21.124+13702020 22.104+08916020 31...0+00004211
51..0.+0000+000 87..00+00001500 88..00+00001500
110008+00001000 21.124+13608180 22.104+08930480 31...0+00007177
51..0.+0000+000 87..00+00001500 88..00+00001500`;

const NIKON = `DTM400,2,9,,NS001,
1,0,MD,aa4,,1.0000,bb0,45.00000,1999-01-19,14:17:12
1,1,MD,4,,110.0000,990.0000,880.0000,1999-01-19,14:17:12
1,2,MD,5,A,2.8320,52.52480,85.49310,3.0000,1999-03-17,18:21:00
1,2,MD,6,ESA,2.8336,53.05380,85.49310,4.0000,1999-03-17,18:21:38`;

const SSS = `TS-700 v3.0
JOB\tD:\\991222,
UNITS\tM,D
STN\tQ130,0.921,
BKB\tN,0.0000,0.0000
SS\tYA01,1.700,
SD\t230.11400,92.20190,29.5270
STN\tYA01,1.487,
BKB\tQ130,50.1140,50.1140
SS\t1001,1.470,101
SD\t164.53450,90.57200,4.7750`;

// 手冊的 TOPCON 編譯範例：原始資料 → SD:1 1.600 326.5635 87.1040 54.118
const GTS = `_'BP_(IP1_)1.600_,1.600_+1_ ?+00054118m0871040+3265635d+00054052***+14+0_*CN_,1.590_+2_ ?+00054113m0871040+3265635d+00054047***+14+0`;

const ZEISS = `For M5|Adr\t13|TI MEASURE
|
For M5|Adr\t15|PI1 101
|SD
7.4657 m
|Hz
11.57451 DMS |V1\t89.50340 DMS
For M5|Adr\t16|PI1 102
|SD
7.4657 m
|Hz
11.57448 DMS |V1\t89.50346 DMS`;

// Sokkia SDR33 定寬欄位（點號 4 碼、數值 10 碼）
const pad = (s: string | number, w: number) => String(s).padStart(w);
const SDR = [
  '00NMSDR33 V04-04.02    11-Jul-87 00:04 113111',
  '02TP' + pad('G1', 4) + pad('100.000', 10) + pad('200.000', 10) + pad('50.000', 10) + pad('1.390', 10),
  '03NM2.200',
  '09F1' + pad('G1', 4) + pad('G2', 4) + pad('25.50', 10) + pad('92.88583', 10) + pad('360.00000', 10),
  '03NM3.100',
  '09F1' + pad('G1', 4) + pad('7', 4) + pad('18.76', 10) + pad('88.81250', 10) + pad('357.34333', 10) + 'TREE',
].join('\n');

describe('儀器格式自動判斷', () => {
  it.each([
    [GEODIMETER, 'geodimeter'], [LEICA, 'gsi'], [NIKON, 'nikon'], [SSS, 'sss'], [GTS, 'gts'], [ZEISS, 'zeiss'], [SDR, 'sdr33'],
    ['ST:T1 T0 1.540 0.0000\nSD:1 1.500 32.5935 94.3641 8.865', '3df'],
  ])('%#', (txt, fmt) => expect(detectFormat(txt)).toBe(fmt));
});

describe('各廠牌轉 3DF', () => {
  it('Trimble Geodimeter', () => {
    const r = parseInstrument(GEODIMETER);
    expect(r.stations).toHaveLength(1);
    expect(r.stations[0]).toMatchObject({ name: 'A142', bs: 'A141', hi: 1.471, bsAngle: '0.0000' });
    expect(r.stations[0].obs).toHaveLength(3);
    expect(r.stations[0].obs[1]).toMatchObject({ name: '2', ht: 3.31, hz: '219.1422', v: '97.4201', dist: 105.47, code: '113' });
  });
  it('Leica GSI（DDDMMSSs 角度、mm 距離）', () => {
    const r = parseInstrument(LEICA);
    const o = r.stations[0].obs;
    expect(o.map(x => x.name)).toEqual(['B1', 'D1', '1000']);
    expect(dmsToDeg(o[0].hz)).toBeCloseTo(315 + 19 / 60 + 29 / 3600, 9);
    expect(dmsToDeg(o[0].v)).toBeCloseTo(89 + 35 / 60 + 55 / 3600, 9);
    expect(o[0].dist).toBe(13.045);
    expect(o[0].ht).toBe(1.5);
    expect(r.stations[0].hi).toBe(1.5);
  });
  it('Nikon DTM：測站、觀測、座標記錄', () => {
    const r = parseInstrument(NIKON);
    expect(r.stations[0]).toMatchObject({ name: 'aa4', bs: 'bb0', hi: 1, bsAngle: '45.00000' });
    expect(r.stations[0].obs[0]).toMatchObject({ name: '5', code: 'A', dist: 2.832, hz: '52.52480', v: '85.49310', ht: 3 });
    expect(r.coords[0]).toMatchObject({ name: '4', y: 110, x: 990, z: 880 });
  });
  it('Topcon SSS', () => {
    const r = parseInstrument(SSS);
    expect(r.stations.map(s => s.name)).toEqual(['Q130', 'YA01']);
    expect(r.stations[0]).toMatchObject({ bs: 'N', hi: 0.921 });
    expect(r.stations[0].obs[0]).toMatchObject({ name: 'YA01', ht: 1.7, hz: '230.11400', v: '92.20190', dist: 29.527 });
    expect(r.stations[1].obs[0].code).toBe('101');
  });
  it('Topcon GTS：與手冊編譯結果一致', () => {
    const r = parseInstrument(GTS);
    expect(r.stations[0]).toMatchObject({ name: 'BP', bs: 'IP1', hi: 1.6 });
    expect(r.stations[0].obs[0]).toMatchObject({ name: '1', ht: 1.6, hz: '326.5635', v: '87.1040', dist: 54.118 });
    expect(r.stations[0].obs[1]).toMatchObject({ name: '2', code: 'CN', ht: 1.59 });
  });
  it('Zeiss M5', () => {
    const r = parseInstrument(ZEISS);
    expect(r.stations[0].obs).toHaveLength(2);
    expect(r.stations[0].obs[0]).toMatchObject({ name: '101', hz: '11.57451', v: '89.50340', dist: 7.4657 });
  });
  it('Sokkia SDR33：十進位度換算成度分秒', () => {
    const r = parseInstrument(SDR);
    expect(r.stations[0]).toMatchObject({ name: 'G1', hi: 1.39 });
    const o = r.stations[0].obs;
    expect(o[0]).toMatchObject({ name: 'G2', ht: 2.2, dist: 25.5 });
    expect(dmsToDeg(o[0].v)).toBeCloseTo(92.88583, 4);
    expect(dmsToDeg(o[1].hz)).toBeCloseTo(357.34333, 4);
    expect(o[1]).toMatchObject({ name: '7', ht: 3.1, code: 'TREE' });
    expect(r.coords[0]).toMatchObject({ name: 'G1', x: 200, y: 100, z: 50 });
  });
});
