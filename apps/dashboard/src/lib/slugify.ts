export default function slugify(input: string, maxLen: number): string {
  const lower = input.toLowerCase().trim();
  let out = "";
  let pendingHyphen = false;
  for (const ch of lower) {
    if ((ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9")) {
      if (pendingHyphen && out.length > 0) {
        out += "-";
      }
      out += ch;
      pendingHyphen = false;
    } else {
      pendingHyphen = true;
    }
    if (out.length >= maxLen) {
      break;
    }
  }
  return out;
}
