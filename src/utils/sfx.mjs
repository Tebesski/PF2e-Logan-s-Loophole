import { MODULE_ID } from "../constants.mjs"
import { Settings } from "../settings.mjs"

export const SFX_KEYS = {
   CONSUME: "consume",
   INTOXICATION: "intoxication",
   ADDICTION: "addiction",
   SATIATION: "satiation",
   WITHDRAWAL: "withdrawal",
   CURE: "cure",
}

export async function resolveWildcard(src) {
   if (!src || typeof src !== "string" || !src.includes("*")) return src

   try {
      const lastSlash = src.lastIndexOf("/")
      const dir = lastSlash >= 0 ? src.substring(0, lastSlash) : ""
      const pattern = lastSlash >= 0 ? src.substring(lastSlash + 1) : src

      let source = "data"
      let targetDir = dir

      const match = dir.match(/^\[(.+?)\]\s*(.*)$/)
      if (match) {
         source = match[1]
         targetDir = match[2]
      }

      const browse = await FilePicker.browse(source, targetDir)
      const files = browse.files || []

      const escapeRegExp = (string) =>
         string.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      const regexStr =
         "^" + pattern.split("*").map(escapeRegExp).join(".*") + "$"
      const regex = new RegExp(regexStr)

      const matches = files.filter((f) => {
         const fileName = f.split("/").pop()
         return regex.test(decodeURIComponent(fileName)) || regex.test(fileName)
      })

      if (matches.length > 0) {
         return matches[Math.floor(Math.random() * matches.length)]
      }
   } catch (err) {
      console.error(
         `${MODULE_ID} | SFX wildcard resolution failed for "${src}":`,
         err,
      )
   }

   return src
}

export async function playLifecycleSfx(key, drug) {
   const perDrug = drug?.sfx?.[key]
   let src = perDrug

   if (!src && key !== SFX_KEYS.CONSUME) {
      const defaults = Settings.defaultSfx ?? {}
      src = defaults[key]
   }
   if (!src || typeof src !== "string" || !src.trim()) return

   try {
      const resolvedSrc = await resolveWildcard(src)
      const helper = foundry.audio?.AudioHelper ?? globalThis.AudioHelper
      if (!helper) return
      await helper.play(
         { src: resolvedSrc, volume: 0.8, autoplay: true, loop: false },
         false,
      )
   } catch (err) {
      console.error(`${MODULE_ID} | SFX failed to play:`, err)
   }
}
