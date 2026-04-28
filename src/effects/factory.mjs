import {
   MODULE_ID,
   EFFECT_TYPE,
   VALUED_CONDITIONS,
} from "../constants.mjs"
import { capitalize } from "../utils/roman.mjs"

export async function buildPhaseWrapper(args) {
   const {
      phase,
      categoryName,
      categoryId,
      label,
      stageNum,
      effects,
      duration,
      img,
      description,
   } = args

   const grants = []
   const rules = []
   let descHtml = ""

   if (description) {
      descHtml += `<p><em>${description}</em></p>`
   }

   if (effects && effects.length > 0) {
      descHtml += `<ul>`
      for (const eff of effects) {
         if (eff.type === EFFECT_TYPE.CONDITION) {
            let uuid = `Compendium.pf2e.conditionitems.Item.${eff.slug}`
            const condItem = game.pf2e?.ConditionManager?.getCondition(eff.slug)
            if (condItem?.sourceId) uuid = condItem.sourceId

            const baseName = condItem ? condItem.name : capitalize(eff.slug)
            const conditionName = baseName + (eff.value ? ` ${eff.value}` : "")
            descHtml += `<li>@UUID[${uuid}]{${conditionName}}</li>`

            grants.push({
               key: "GrantItem",
               uuid: uuid,
               inMemoryOnly: false,
               onDeleteActions: { granter: "cascade", grantee: "restrict" },
               ...(VALUED_CONDITIONS.has(eff.slug) && {
                  alterations: [
                     {
                        mode: "override",
                        property: "badge-value",
                        value: Number(eff.value) || 1,
                     },
                  ],
               }),
            })
         } else if (eff.type === EFFECT_TYPE.UUID && eff.uuid) {
            const item = await fromUuid(eff.uuid)
            const itemName = item ? item.name : "Effect"
            descHtml += `<li>@UUID[${eff.uuid}]{${itemName}}</li>`
            grants.push({
               key: "GrantItem",
               uuid: eff.uuid,
               inMemoryOnly: false,
               onDeleteActions: { granter: "cascade", grantee: "restrict" },
            })
         } else if (eff.type === EFFECT_TYPE.RULE) {
            const ruleObj = _parseRuleSafe(eff.ruleJson ?? eff.ruleData)
            if (ruleObj) {
               const customDesc =
                  typeof eff.ruleDescription === "string"
                     ? eff.ruleDescription.trim()
                     : ""
               const labelKey = ruleObj.key || "Rule"
               const display = customDesc || `Rule: ${labelKey}`
               const safe = display
                  .replace(/&/g, "&amp;")
                  .replace(/</g, "&lt;")
                  .replace(/>/g, "&gt;")
               descHtml += `<li><em>${safe}</em></li>`
               rules.push(ruleObj)
            }
         }
      }
      descHtml += `</ul>`
   }

   const isUnlimited = !duration || !duration.value || duration.value <= 0

   const dedupedRules = _dedupeRules([...grants, ...rules])

   const wrapper = {
      name: `${categoryName}: ${label}`,
      type: "effect",
      img: img || "icons/svg/aura.svg",
      system: {
         description: { value: descHtml },
         tokenIcon: { show: false },
         level: { value: 1 },
         duration: {
            value: isUnlimited ? -1 : duration.value,
            unit: isUnlimited ? "unlimited" : duration.unit,
            sustained: false,
            expiry: "turn-start",
         },
         rules: dedupedRules,
      },
      flags: {
         [MODULE_ID]: { managed: true, phase, category: categoryId },
      },
   }
   return wrapper
}

function _parseRuleSafe(input) {
   if (!input) return null
   if (typeof input === "object" && !Array.isArray(input)) {
      return input.key && typeof input.key === "string" ? input : null
   }
   if (typeof input !== "string") return null
   const trimmed = input.trim()
   if (!trimmed) return null
   try {
      const parsed = JSON.parse(trimmed)
      if (
         !parsed ||
         typeof parsed !== "object" ||
         Array.isArray(parsed) ||
         typeof parsed.key !== "string" ||
         !parsed.key
      ) {
         return null
      }
      return parsed
   } catch (_e) {
      return null
   }
}

function _dedupeRules(rules) {
   const seen = new Set()
   const out = []
   for (const r of rules) {
      let key
      try {
         key = JSON.stringify(r)
      } catch (_e) {
         out.push(r)
         continue
      }
      if (!seen.has(key)) {
         seen.add(key)
         out.push(r)
      }
   }
   return out
}

export async function removePhaseEffects(actor, categoryId, phase) {
   if (!actor?.items) return
   const wrappers = actor.items.filter((i) => {
      const f = i.flags?.[MODULE_ID]
      if (!f?.managed) return false
      if (f.category !== categoryId) return false
      return phase === null || f.phase === phase
   })
   if (!wrappers.length) return

   const grantIds = new Set()
   for (const wrapper of wrappers) {
      const grants = wrapper.flags?.pf2e?.itemGrants ?? {}
      for (const g of Object.values(grants)) {
         if (g?.id) grantIds.add(g.id)
      }
   }

   const wrapperIds = wrappers
      .map((w) => w.id)
      .filter((id) => actor.items.has(id))
   if (wrapperIds.length) {
      await actor.deleteEmbeddedDocuments("Item", wrapperIds, {
         logansLoophole: true,
         dialog: false,
      })
   }

   const orphanGrantIds = [...grantIds].filter((id) => actor.items.has(id))
   if (orphanGrantIds.length) {
      await actor.deleteEmbeddedDocuments("Item", orphanGrantIds, {
         logansLoophole: true,
         dialog: false,
      })
   }
}

export function activePhases(actor, categoryId) {
   return actor.items
      .filter((i) => {
         const f = i.flags?.[MODULE_ID]
         return f?.managed && f.category === categoryId
      })
      .map((i) => i.flags[MODULE_ID].phase)
}
