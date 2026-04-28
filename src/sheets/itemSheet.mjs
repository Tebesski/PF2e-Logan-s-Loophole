import {
   MODULE_ID,
   FLAG,
   DEFAULT_DRUG,
   PF2E_DAMAGE_TYPES,
   EXPOSURE_TRAITS,
   EXPOSURE_SLUGS,
   canEditRegistry,
} from "../constants.mjs"
import { listCategories, getCategory } from "../registry/registry.mjs"
import {
   exportDrugItem,
   importDrugItemJson,
   downloadJson,
   pickJsonFile,
} from "../utils/portability.mjs"
import { CategoryRegistryApp } from "../apps/categoryRegistryApp.mjs"
import { resolveWildcard } from "../utils/sfx.mjs"

const SFX_ROW_DEFS = [
   { key: "consume", labelKey: "LL.SFX.Consume", tipKey: "LL.SFX.ConsumeTip" },
   {
      key: "intoxication",
      labelKey: "LL.SFX.Intoxication",
      tipKey: "LL.SFX.IntoxicationTip",
   },
   {
      key: "addiction",
      labelKey: "LL.SFX.Addiction",
      tipKey: "LL.SFX.AddictionTip",
   },
   {
      key: "satiation",
      labelKey: "LL.SFX.Satiation",
      tipKey: "LL.SFX.SatiationTip",
   },
   {
      key: "withdrawal",
      labelKey: "LL.SFX.Withdrawal",
      tipKey: "LL.SFX.WithdrawalTip",
   },
   { key: "cure", labelKey: "LL.SFX.Cure", tipKey: "LL.SFX.CureTip" },
]

export function registerItemSheetHook() {
   Hooks.on("renderItemSheet", _onRender)
   Hooks.on("renderItemSheetV2", _onRender)

   Hooks.on("preUpdateItem", (item, changes) => {
      if (item.type !== "consumable") return
      const newTraits = changes.system?.traits?.value
      if (!newTraits || !Array.isArray(newTraits)) return

      const oldTraits = item.system?.traits?.value || []
      const hadDrug = oldTraits.includes("drug")
      const hasDrug = newTraits.includes("drug")

      if (!hadDrug && hasDrug) {
         if (!newTraits.includes("poison")) newTraits.push("poison")
         if (!EXPOSURE_SLUGS.some((s) => newTraits.includes(s))) {
            newTraits.push("ingested")
         }
      }
   })
}

function _asJQuery(html) {
   if (!html) return null
   if (typeof html.find === "function" && typeof html.append === "function") {
      return html
   }
   if (html instanceof HTMLElement || html instanceof DocumentFragment) {
      if (typeof globalThis.$ === "function") return globalThis.$(html)
      if (typeof globalThis.jQuery === "function")
         return globalThis.jQuery(html)
   }
   return null
}

async function _enrichCategoryData(category) {
   if (!category) return null
   const cat = foundry.utils.deepClone(category)

   const resolveEffects = async (effects) => {
      if (!Array.isArray(effects)) return
      for (const eff of effects) {
         if (eff.type === "condition") {
            const c = game.pf2e?.ConditionManager?.getCondition(eff.slug)
            const name = c
               ? c.name
               : eff.slug.charAt(0).toUpperCase() + eff.slug.slice(1)
            const val = eff.value ? ` ${eff.value}` : ""
            const uuid =
               c?.sourceId || `Compendium.pf2e.conditionitems.Item.${eff.slug}`

            const linkStr = `@UUID[${uuid}]{${name}${val}}`
            eff.html = await TextEditor.enrichHTML(linkStr, { async: true })
         } else if (eff.type === "uuid" && eff.uuid) {
            const doc = await fromUuid(eff.uuid).catch(() => null)
            const name = doc ? doc.name : "Unknown Item"

            const linkStr = `@UUID[${eff.uuid}]{${name}}`
            eff.html = await TextEditor.enrichHTML(linkStr, { async: true })
         } else {
            eff.html = `<span class="ll-tag">Rule Element</span>`
         }
      }
   }

   for (const stg of cat.acute?.intoxStages || [])
      await resolveEffects(stg.effects)
   if (cat.acute?.overdose) {
      await resolveEffects(cat.acute.overdose.criticalSuccess?.effects)
      await resolveEffects(cat.acute.overdose.success?.effects)
      await resolveEffects(cat.acute.overdose.failure?.effects)
      await resolveEffects(cat.acute.overdose.criticalFailure?.effects)
   }
   await resolveEffects(cat.acute?.hangover?.effects)
   for (const stg of cat.chronic?.addictionStages || []) {
      await resolveEffects(stg.chronicEffects)
      await resolveEffects(stg.withdrawalEffects)
   }

   return cat
}

async function _onRender(sheet, html, _data) {
   const item = sheet.item ?? sheet.document
   if (!item || item.type !== "consumable") return

   const traits = item.system?.traits?.value ?? []
   if (!Array.isArray(traits) || !traits.includes("drug")) return

   const $html = _asJQuery(html)
   if (!$html) return

   if ($html.find(".ll-drug-tab").length > 0) return

   $html.find(".ll-drug-nav-item").remove()
   $html.find(".ll-drug-tab").remove()
   $html.find(".ll-drug-summary").remove()

   if (sheet._llActiveTab === undefined) {
      sheet._llActiveTab = sheet._tabs?.[0]?.active ?? "description"
   }
   $html.on("click", ".sheet-navigation .item", (ev) => {
      sheet._llActiveTab = ev.currentTarget.dataset.tab
   })

   const drug = foundry.utils.mergeObject(
      DEFAULT_DRUG(),
      item.getFlag(MODULE_ID, FLAG.DRUG) ?? {},
      { inplace: false },
   )

   const categories = Object.values(listCategories()).sort((a, b) =>
      (a.name ?? "").localeCompare(b.name ?? ""),
   )
   const category = drug.categoryId ? getCategory(drug.categoryId) : null

   const currentExposure =
      EXPOSURE_TRAITS.find((t) => traits.includes(t.slug))?.slug || ""

   const tabContent = await renderTemplate(
      `modules/${MODULE_ID}/templates/item-drug-tab.hbs`,
      {
         drug,
         categories,
         category,
         isOwner: item.isOwner,
         damageTypes: PF2E_DAMAGE_TYPES,
         sfxRows: _getSfxRows(),
         exposureMethods: EXPOSURE_TRAITS,
         currentExposure,
      },
   )

   const tabNav = $html.find(".sheet-navigation .item, .tabs [data-tab]").last()
   tabNav.after(
      `<a class="item ll-drug-nav-item" data-tab="ll-drug" data-tooltip="Drug Config" title="Drug Config" aria-label="Drug Config"><i class="fas fa-flask"></i></a>`,
   )
   const body = $html.find(".sheet-body, .tab-body").first()
   body.append(
      `<div class="tab ll-drug-tab" data-tab="ll-drug">${tabContent}</div>`,
   )

   try {
      sheet._tabs?.[0]?.bind($html[0])
   } catch (_e) {}

   if (sheet._llActiveTab === "ll-drug") {
      $html.find(".sheet-navigation .item").removeClass("active")
      $html.find(".ll-drug-nav-item").addClass("active")
      $html.find(".sheet-body > .tab").removeClass("active")
      $html.find(".ll-drug-tab").addClass("active")
   }

   if (category) {
      const enrichedCategory = await _enrichCategoryData(category)
      const summary = await renderTemplate(
         `modules/${MODULE_ID}/templates/item-summary.hbs`,
         {
            drug,
            category: enrichedCategory,
         },
      )
      const descTab = $html.find(".tab.description[data-tab='description']")
      if (descTab.length) {
         descTab.append(`<div class="ll-drug-summary">${summary}</div>`)
         _watchForDescriptionEditMode(descTab[0])
      }
   }

   if (item.isOwner) _activateListeners($html, item, sheet)
}

function _watchForDescriptionEditMode(descTab) {
   if (!descTab) return
   const summary = descTab.querySelector(".ll-drug-summary")
   if (!summary) return

   const isEditing = () => {
      if (descTab.querySelector(".editor-active")) return true
      if (descTab.querySelector(".editor.prosemirror-active")) return true
      if (descTab.querySelector(".ProseMirror-menubar")) return true
      if (descTab.querySelector("prose-mirror[active]")) return true
      if (descTab.querySelector(".editor-content.ProseMirror")) return true
      return false
   }

   const apply = () => {
      summary.style.display = isEditing() ? "none" : ""
   }
   apply()

   const observer = new MutationObserver(apply)
   observer.observe(descTab, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "active"],
   })
}

function _activateListeners(html, item, sheet) {
   const tab = html.find(".ll-drug-tab")

   tab.on("click", ".ll-pill.is-clickable", async () => {
      const drug = item.getFlag(MODULE_ID, FLAG.DRUG)
      if (!drug?.categoryId) return
      if (!canEditRegistry()) {
         ui.notifications?.warn(
            "Only GMs and Assistant GMs can open the Category Registry.",
         )
         return
      }
      await CategoryRegistryApp.openWithCategory(drug.categoryId)
   })

   tab.on("change", "[data-action='change-exposure']", async (ev) => {
      const newExposure = ev.currentTarget.value
      const oldTraits = item.system?.traits?.value ?? []

      const updatedTraits = oldTraits.filter((t) => !EXPOSURE_SLUGS.includes(t))
      if (newExposure) updatedTraits.push(newExposure)

      await item.update({ "system.traits.value": updatedTraits })
   })

   tab.on("change", "[data-ll-path]", async (ev) => {
      const el = ev.currentTarget
      const path = el.dataset.llPath
      if (!path) return
      let value
      if (el.type === "checkbox") value = el.checked
      else if (el.type === "number") value = Number(el.value) || 0
      else value = el.value
      const current = foundry.utils.mergeObject(
         DEFAULT_DRUG(),
         item.getFlag(MODULE_ID, FLAG.DRUG) ?? {},
         { inplace: false },
      )
      foundry.utils.setProperty(current, path, value)

      if (path === "categoryId") {
         await item.update({ [`flags.${MODULE_ID}.${FLAG.DRUG}`]: current })
      } else {
         await item.update(
            { [`flags.${MODULE_ID}.${FLAG.DRUG}`]: current },
            { render: false },
         )
      }
   })

   tab.on("click", "[data-action='export-drug-item']", async () => {
      try {
         const json = exportDrugItem(item)
         const slug = (item.name ?? "drug")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
         downloadJson(json, `ll-drug-${slug || "item"}.json`)
      } catch (err) {
         ui.notifications?.error(
            game.i18n.format("LL.ItemSheet.ExportFailed", {
               message: err.message,
            }),
         )
      }
   })

   tab.on("click", "[data-action='import-drug-item']", async () => {
      try {
         const text = await pickJsonFile()
         if (!text) return
         const { warnings } = await importDrugItemJson(item, text)
         ui.notifications?.info(
            game.i18n.format("LL.ItemSheet.ImportSuccess", {
               itemName: item.name,
            }),
         )
         for (const w of warnings) ui.notifications?.warn(w)
      } catch (err) {
         ui.notifications?.error(
            game.i18n.format("LL.ItemSheet.ImportFailed", {
               message: err.message,
            }),
         )
      }
   })

   tab.on("click", "[data-action='pick-sfx-drug']", async (ev) => {
      const key = ev.currentTarget.dataset.sfxKey
      const current = item.getFlag(MODULE_ID, FLAG.DRUG)?.sfx?.[key] ?? ""
      const FP =
         foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker
      new FP({
         type: "audio",
         current,
         callback: async (chosen) => {
            const cur = foundry.utils.mergeObject(
               DEFAULT_DRUG(),
               item.getFlag(MODULE_ID, FLAG.DRUG) ?? {},
               { inplace: false },
            )
            cur.sfx ??= {}
            cur.sfx[key] = chosen
            await item.update(
               { [`flags.${MODULE_ID}.${FLAG.DRUG}`]: cur },
               { render: false },
            )
            const input = tab.find(`input[data-ll-path='sfx.${key}']`)[0]
            if (input) input.value = chosen
         },
      }).render(true)
   })

   tab.on("click", "[data-action='clear-sfx-drug']", async (ev) => {
      const key = ev.currentTarget.dataset.sfxKey
      const cur = foundry.utils.mergeObject(
         DEFAULT_DRUG(),
         item.getFlag(MODULE_ID, FLAG.DRUG) ?? {},
         { inplace: false },
      )
      cur.sfx ??= {}
      cur.sfx[key] = ""
      await item.update(
         { [`flags.${MODULE_ID}.${FLAG.DRUG}`]: cur },
         { render: false },
      )
      const input = tab.find(`input[data-ll-path='sfx.${key}']`)[0]
      if (input) input.value = ""
   })

   tab.on("click", "[data-action='preview-sfx-drug']", async (ev) => {
      const key = ev.currentTarget.dataset.sfxKey
      const src = item.getFlag(MODULE_ID, FLAG.DRUG)?.sfx?.[key]
      if (!src) {
         ui.notifications?.warn(game.i18n.localize("LL.ItemSheet.NoSoundSet"))
         return
      }
      try {
         const resolvedSrc = await resolveWildcard(src)
         const helper = foundry.audio?.AudioHelper ?? globalThis.AudioHelper
         if (!helper) return
         await helper.play(
            { src: resolvedSrc, volume: 0.8, autoplay: true, loop: false },
            false,
         )
      } catch (err) {
         ui.notifications?.error(
            game.i18n.format("LL.ItemSheet.PreviewFailed", {
               message: err.message,
            }),
         )
      }
   })
}

function _getSfxRows() {
   return SFX_ROW_DEFS.map(({ key, labelKey, tipKey }) => ({
      key,
      label: game.i18n.localize(labelKey),
      tip: game.i18n.localize(tipKey),
   }))
}
