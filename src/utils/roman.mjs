export function toRoman(num) {
   const rules = {
      M: 1000,
      CM: 900,
      D: 500,
      CD: 400,
      C: 100,
      XC: 90,
      L: 50,
      XL: 40,
      X: 10,
      IX: 9,
      V: 5,
      IV: 4,
      I: 1,
   }
   let res = ""
   let n = Number(num) || 0
   for (const [k, v] of Object.entries(rules)) {
      while (n >= v) {
         res += k
         n -= v
      }
   }
   return res || "0"
}

export function capitalize(str) {
   if (!str) return ""
   return String(str).charAt(0).toUpperCase() + String(str).slice(1)
}
