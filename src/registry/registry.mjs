import { DEFAULT_CATEGORY } from "../constants.mjs"
import { Settings } from "../settings.mjs"

export function listCategories() {
   return Settings.registry?.categories ?? {}
}

export function getCategory(categoryId) {
   if (!categoryId) return null
   return listCategories()[categoryId] ?? null
}

export async function createCategory(seed = {}) {
   const cat = foundry.utils.mergeObject(DEFAULT_CATEGORY(), seed, {
      inplace: false,
   })
   const reg = Settings.registry
   reg.categories ??= {}
   reg.categories[cat.id] = cat
   await Settings.setRegistry(reg)
   return cat
}

export async function updateCategory(categoryId, updated) {
   const reg = Settings.registry
   reg.categories ??= {}
   if (!reg.categories[categoryId]) {
      throw new Error(
         `Logan's Loophole: cannot update unknown category "${categoryId}"`,
      )
   }
   updated.id = categoryId
   reg.categories[categoryId] = updated
   await Settings.setRegistry(reg)
}

export async function deleteCategory(categoryId) {
   const reg = Settings.registry
   if (!reg.categories?.[categoryId]) return false
   delete reg.categories[categoryId]
   await Settings.setRegistry(reg)
   return true
}

export function intoxStageForToxicity(category, toxicity) {
   const stages = category?.acute?.intoxStages ?? []
   let idx = -1
   for (let i = 0; i < stages.length; i++) {
      if (toxicity >= (stages[i]?.tox ?? Infinity)) idx = i
      else break
   }
   return idx
}

export function addictionStageConfig(category, stageNum) {
   if (stageNum < 1) return null
   return category?.chronic?.addictionStages?.[stageNum - 1] ?? null
}

export function maxAddictionStage(category) {
   return Math.max(1, category?.chronic?.addictionStages?.length ?? 1)
}

export function stageForAP(category, ap) {
   const stages = category?.chronic?.addictionStages ?? []
   const points = Math.max(0, Number(ap) || 0)
   let stage = 0
   for (let i = 0; i < stages.length; i++) {
      const threshold = Number(stages[i]?.apThreshold) || 0
      if (points >= threshold) stage = i + 1
      else break
   }
   return stage
}

export function apThresholdForStage(category, stageNum) {
   if (stageNum <= 0) return 0
   const cfg = addictionStageConfig(category, stageNum)
   return cfg ? Number(cfg.apThreshold) || 0 : null
}

export function buildRollOptions(category, type, extra = []) {
   if (!category) return extra
   const base = [
      "drug",
      category.name.slugify(),
      ...(category.rollOptions || "")
         .split(",")
         .map((s) => s.trim())
         .filter(Boolean),
   ]
   let specific = []
   if (type === "intoxication") {
      specific = [
         "intoxication",
         ...(category.acute?.rollOptions || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
      ]
   } else if (type === "overdose") {
      specific = [
         "overdose",
         ...(category.acute?.overdose?.rollOptions || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
      ]
   } else if (type === "hangover") {
      specific = [
         "hangover",
         ...(category.acute?.hangover?.rollOptions || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
      ]
   } else if (type === "addiction") {
      specific = [
         "addiction",
         ...(category.chronic?.rollOptions || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
      ]
   } else if (type === "treatment") {
      specific = ["treatment"]
   }
   return [...new Set([...base, ...specific, ...extra])]
}
