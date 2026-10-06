declare module 'cdt2d' {
  interface Options { delaunay?: boolean; interior?: boolean; exterior?: boolean; infinity?: boolean }
  /** 約束 Delaunay 三角化：回傳三角形頂點索引 */
  export default function cdt2d(points: Array<[number, number]>, edges?: Array<[number, number]>, options?: Options): Array<[number, number, number]>;
}
