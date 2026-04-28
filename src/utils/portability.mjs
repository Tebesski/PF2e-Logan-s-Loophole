import {
   MODULE_ID,
   FLAG,
   ENVELOPE_VERSION,
   DEFAULT_CONSUMABLE_ICON,
} from "../constants.mjs"
import {
   getCategory,
   listCategories,
   createCategory,
} from "../registry/registry.mjs"

export function exportCategory(categoryId) {
   const cat = getCategory(categoryId)
   if (!cat) throw new Error(`Category "${categoryId}" not found.`)
   const envelope = {
      module: MODULE_ID,
      version: ENVELOPE_VERSION,
      kind: "category",
      data: foundry.utils.deepClone(cat),
   }
   return JSON.stringify(envelope, null, 2)
}

export function exportAllCategories() {
   const all = Object.values(listCategories())
   const envelope = {
      module: MODULE_ID,
      version: ENVELOPE_VERSION,
      kind: "category-bundle",
      data: foundry.utils.deepClone(all),
   }
   return JSON.stringify(envelope, null, 2)
}

export async function importCategoryJson(jsonText) {
   const env = _parseEnvelope(jsonText)
   const errors = []
   let cats = []

   if (env.kind === "category") {
      cats = [env.data]
   } else if (env.kind === "category-bundle") {
      if (!Array.isArray(env.data)) {
         throw new Error("Bundle file's data is not an array.")
      }
      cats = env.data
   } else {
      throw new Error(
         `Unexpected file kind "${env.kind}". Expected "category" or "category-bundle".`,
      )
   }

   let imported = 0
   const existing = listCategories()
   const existingIds = new Set(Object.keys(existing))
   const existingNames = new Set(Object.values(existing).map((c) => c.name))

   for (const raw of cats) {
      if (!raw || typeof raw !== "object") {
         errors.push("Skipped a malformed entry (not an object).")
         continue
      }
      try {
         const seed = { ...raw }
         if (seed.id && existingIds.has(seed.id)) {
            delete seed.id
         }

         let name = seed.name || "(unnamed)"
         if (existingNames.has(name)) {
            let suffixCounter = 1
            let checkName = `${name} (imported)`
            while (existingNames.has(checkName)) {
               suffixCounter++
               checkName = `${name} (imported ${suffixCounter})`
            }
            name = checkName
         }

         existingNames.add(name)
         const created = await createCategory({ ...seed, name })
         existingIds.add(created.id)
         imported++
      } catch (err) {
         errors.push(`"${raw.name ?? "(unnamed)"}": ${err.message}`)
      }
   }
   return { imported, errors }
}

export function exportDrugItem(item) {
   if (item?.type !== "consumable") {
      throw new Error("Only consumable items can be exported as drug items.")
   }
   const drug = item.getFlag?.(MODULE_ID, FLAG.DRUG)
   if (!drug?.categoryId) {
      throw new Error(
         "This item has no Logan's Loophole drug config to export.",
      )
   }
   const envelope = {
      module: MODULE_ID,
      version: ENVELOPE_VERSION,
      kind: "drug-item",
      data: {
         name: item.name,
         img: item.img,
         system: foundry.utils.deepClone(item.system ?? {}),
         drug: foundry.utils.deepClone(drug),
         categoryName:
            getCategory(drug.categoryId)?.name ?? "(unknown category)",
      },
   }
   return JSON.stringify(envelope, null, 2)
}

export async function importDrugItemJson(item, jsonText) {
   if (!item) throw new Error("No target item provided.")
   const env = _parseEnvelope(jsonText)
   if (env.kind !== "drug-item") {
      throw new Error(
         `Unexpected file kind "${env.kind}". Expected "drug-item".`,
      )
   }
   const payload = env.data ?? {}
   const warnings = []

   const drug = { ...(payload.drug ?? {}) }

   if (drug.categoryId && !getCategory(drug.categoryId)) {
      const allCats = Object.values(listCategories())
      const matchedCat = allCats.find((c) => c.name === payload.categoryName)

      if (matchedCat) {
         drug.categoryId = matchedCat.id
         warnings.push(
            `Category ID changed across worlds. Automatically rebound to "${matchedCat.name}".`,
         )
      } else {
         warnings.push(
            `Referenced category "${payload.categoryName ?? drug.categoryId}" is not in this world's registry. The item has been imported unbound — rebind it in the Drug tab.`,
         )
         drug.categoryId = ""
      }
   }

   const patch = {}
   if (payload.name) patch.name = payload.name

   if (item.img === DEFAULT_CONSUMABLE_ICON) {
      const category = drug.categoryId ? getCategory(drug.categoryId) : null
      const newImg = category?.img ?? payload.img
      if (newImg) patch.img = newImg
   }

   const sys = payload.system ?? {}
   const systemPatch = {}
   if (sys.description) systemPatch.description = sys.description
   if (sys.level) systemPatch.level = sys.level
   if (sys.price) systemPatch.price = sys.price
   if (sys.bulk) systemPatch.bulk = sys.bulk
   if (sys.rarity) systemPatch.rarity = sys.rarity
   if (sys.traits) systemPatch.traits = sys.traits
   if (sys.usage) systemPatch.usage = sys.usage
   if (sys.uses) systemPatch.uses = sys.uses
   if (sys.category) systemPatch.category = sys.category
   if (sys.damage) systemPatch.damage = sys.damage
   if (sys.spell) systemPatch.spell = sys.spell
   if (sys.publication) systemPatch.publication = sys.publication
   if (Array.isArray(sys.rules)) systemPatch.rules = sys.rules

   if (Object.keys(systemPatch).length > 0) patch.system = systemPatch

   await item.update(patch)
   await item.setFlag(MODULE_ID, FLAG.DRUG, drug)

   return { warnings }
}

function _parseEnvelope(jsonText) {
   let env
   try {
      env = JSON.parse(jsonText)
   } catch (err) {
      throw new Error(`Invalid JSON: ${err.message}`)
   }
   if (!env || typeof env !== "object") {
      throw new Error("Envelope is not an object.")
   }
   if (env.module !== MODULE_ID) {
      throw new Error(
         `Envelope is not a Logan's Loophole file (module="${env.module ?? "unknown"}").`,
      )
   }
   if (typeof env.version !== "number") {
      throw new Error("Envelope is missing a version number.")
   }
   if (env.version > ENVELOPE_VERSION) {
      throw new Error(
         `Envelope version ${env.version} is newer than this module supports (${ENVELOPE_VERSION}). Update the module.`,
      )
   }
   return env
}

export function downloadJson(jsonText, filename) {
   if (typeof saveDataToFile === "function") {
      try {
         saveDataToFile(jsonText, "application/json", filename)
         return
      } catch (_e) {}
   }
   if (foundry?.utils?.saveDataToFile) {
      try {
         foundry.utils.saveDataToFile(jsonText, "application/json", filename)
         return
      } catch (_e) {}
   }
   const blob = new Blob([jsonText], { type: "application/json" })
   const url = URL.createObjectURL(blob)
   const a = document.createElement("a")
   a.href = url
   a.download = filename
   document.body.appendChild(a)
   a.click()
   document.body.removeChild(a)
   setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function pickJsonFile() {
   return new Promise((resolve, reject) => {
      const input = document.createElement("input")
      input.type = "file"
      input.accept = ".json,application/json"
      input.addEventListener("change", () => {
         const file = input.files?.[0]
         if (!file) return resolve(null)
         const reader = new FileReader()
         reader.onload = () => resolve(String(reader.result ?? ""))
         reader.onerror = () => reject(reader.error)
         reader.readAsText(file)
      })
      input.click()
   })
}
