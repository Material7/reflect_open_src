/** コメント本文中のメンション表現 <@社員番号> を抽出する正規表現 */
export const MENTION_TOKEN = /<@([^>\s]+)>/g;

type NameResolver = Record<string, string> | Map<string, string>;

const resolve = (map: NameResolver, key: string): string | undefined =>
  map instanceof Map ? map.get(key) : map[key];

/** コメント本文の <@社員番号> を [@表示名] のプレーンテキストへ変換（エクスポート等で使用） */
export function mentionsToPlainText(content: string, nameByEmpNo: NameResolver): string {
  return content.replace(MENTION_TOKEN, (_, emp) => `[@${resolve(nameByEmpNo, emp) ?? emp}]`);
}
