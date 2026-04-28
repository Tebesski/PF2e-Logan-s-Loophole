import {
   MODULE_ID,
   TIME_UNIT,
   PF2E_DAMAGE_TYPES,
   PF2E_CONDITIONS_ALL,
   VALUED_CONDITIONS,
} from "../constants.mjs"
import {
   listCategories,
   createCategory,
   updateCategory,
   deleteCategory,
   getCategory,
} from "../registry/registry.mjs"
import { toRoman } from "../utils/roman.mjs"
import {
   exportCategory,
   exportAllCategories,
   importCategoryJson,
   downloadJson,
   pickJsonFile,
} from "../utils/portability.mjs"

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } =
   foundry.applications.api

export class CategoryRegistryApp extends HandlebarsApplicationMixin(
   ApplicationV2,
) {
   static async openWithCategory(categoryId) {
      const existing =
         Array.from(foundry.applications?.instances?.values() ?? []).find(
            (w) => w instanceof CategoryRegistryApp,
         ) ??
         Object.values(ui.windows ?? {}).find(
            (w) => w instanceof CategoryRegistryApp,
         )
      const app = existing ?? new CategoryRegistryApp()
      if (categoryId) {
         app._selectedId = categoryId
         app._draft = null
      }
      app.render(true)
   }

   static DEFAULT_OPTIONS = {
      id: "ll-category-registry",
      classes: ["logans-loophole", "ll-registry"],
      tag: "form",
      window: {
         title: "LL.Registry.Title",
         icon: "fas fa-flask",
         resizable: true,
      },
      position: { width: 1100, height: 750 },
      form: {
         submitOnChange: false,
         closeOnSubmit: false,
      },
      actions: {
         "create-category": CategoryRegistryApp._onCreateCategory,
         "delete-category": CategoryRegistryApp._onDeleteCategory,
         "select-category": CategoryRegistryApp._onSelectCategory,
         "pick-file": CategoryRegistryApp._onPickIcon,
         "add-intox-stage": CategoryRegistryApp._onAddIntoxStage,
         "remove-intox-stage": CategoryRegistryApp._onRemoveIntoxStage,
         "add-addiction-stage": CategoryRegistryApp._onAddAddictionStage,
         "remove-addiction-stage": CategoryRegistryApp._onRemoveAddictionStage,
         "add-effect-condition": CategoryRegistryApp._onAddEffectCondition,
         "add-effect-uuid": CategoryRegistryApp._onAddEffectUuid,
         "add-effect-rule": CategoryRegistryApp._onAddEffectRule,
         "remove-effect": CategoryRegistryApp._onRemoveEffect,
         "open-effect": CategoryRegistryApp._onOpenEffect,
         "save-category": CategoryRegistryApp._onSaveCategory,
         "export-category": CategoryRegistryApp._onExportCategory,
         "export-all-categories": CategoryRegistryApp._onExportAllCategories,
         "import-category": CategoryRegistryApp._onImportCategory,
      },
   }

   static PARTS = {
      main: {
         template: `modules/${MODULE_ID}/templates/registry-app.hbs`,
      },
   }

   _selectedId = null
   _draft = null
   _viewState = { scroll: 0, accordions: [] }

   async _prepareContext() {
      const categories = Object.values(listCategories()).sort((a, b) =>
         a.name.localeCompare(b.name),
      )

      if (this._selectedId && !this._draft) {
         const source = getCategory(this._selectedId)
         if (source) {
            this._draft = foundry.utils.deepClone(source)
            _normalizeDraft(this._draft)
         }
      }

      const conditionsAll = PF2E_CONDITIONS_ALL.map((slug) => {
         const condItem = game.pf2e?.ConditionManager?.getCondition(slug)
         return {
            slug,
            label:
               slug.charAt(0).toUpperCase() + slug.slice(1).replace("-", " "),
            valued: VALUED_CONDITIONS.has(slug),
            img: condItem?.img || "systems/pf2e/icons/conditions/default.webp",
         }
      })

      if (this._draft) {
         _resolveEffectNames(this._draft.acute?.intoxStages)
         _resolveEffectNames(this._draft.acute?.overdose)
         _resolveEffectNames(this._draft.acute?.overdose?.criticalSuccess?.effects)
         _resolveEffectNames(this._draft.acute?.overdose?.success?.effects)
         _resolveEffectNames(this._draft.acute?.overdose?.failure?.effects)
         _resolveEffectNames(this._draft.acute?.overdose?.criticalFailure?.effects)
         _resolveEffectNames(this._draft.acute?.hangover)
         _resolveEffectNames(this._draft.acute?.hangover?.failure?.effects)
         _resolveEffectNames(this._draft.acute?.hangover?.criticalFailure?.effects)
         _resolveEffectNames(this._draft.chronic?.addictionStages)
      }

      return {
         categories,
         selectedId: this._selectedId,
         draft: this._draft,
         isDirty: this._isDirty(),
         damageTypes: PF2E_DAMAGE_TYPES,
         conditionsAll,
         timeUnits: Object.keys(TIME_UNIT),
      }
   }

   _isDirty() {
      if (!this._selectedId || !this._draft) return false
      const source = getCategory(this._selectedId)
      if (!source) return true
      return JSON.stringify(source) !== JSON.stringify(this._draft)
   }

   _saveViewState() {
      if (!this.element) return
      const editor = this.element.querySelector(".ll-registry__editor")
      this._viewState.scroll = editor ? editor.scrollTop : 0
      this._viewState.accordions = Array.from(
         this.element.querySelectorAll("details[open]"),
      )
         .map((el) => el.dataset.accordionKey)
         .filter(Boolean)
   }

   _restoreViewState() {
      if (!this.element) return

      this._viewState.accordions.forEach((key) => {
         const el = this.element.querySelector(
            `details[data-accordion-key="${key}"]`,
         )
         if (el) el.open = true
      })

      const editor = this.element.querySelector(".ll-registry__editor")
      if (editor) {
         const targetScroll = this._scrollToTopOnNextRender
            ? 0
            : this._viewState.scroll
         requestAnimationFrame(() => {
            editor.scrollTop = targetScroll
         })
         if (this._scrollToTopOnNextRender) {
            this._scrollToTopOnNextRender = false
         }
      }
   }

   _onRender(context, options) {
      super._onRender(context, options)
      this._bindDraftInputs()
      _activateDropZones(this.element, this)
      this._restoreViewState()
   }

   _bindDraftInputs() {
      if (!this.element) return
      const form =
         this.element.tagName === "FORM"
            ? this.element
            : this.element.querySelector("form")
      if (!form) return

      form
         .querySelectorAll(
            "input[data-ll-path], select[data-ll-path], textarea[data-ll-path]",
         )
         .forEach((el) => {
            const isRuleJson = el.classList.contains("ll-effect__rule-json")
            const isRuleDesc = el.classList.contains("ll-effect__rule-description")

            if (isRuleJson) {
               this._bindRuleJsonInput(el)
               return
            }

            if (isRuleDesc) {
               this._bindRuleDescriptionInput(el)
               return
            }

            el.addEventListener("change", async (ev) => {
               if (!this._draft) return
               this._saveViewState()
               let val = el.type === "checkbox" ? el.checked : el.value
               if (el.type === "number") val = Number(val) || 0

               if (el.classList.contains("ll-effect__uuid") && val) {
                  const doc = await fromUuid(val).catch(() => null)
                  if (!doc || doc.type !== "effect") {
                     ui.notifications?.error(
                        game.i18n.localize("LL.Registry.InvalidEffectUUID"),
                     )
                     val = ""
                     el.value = ""
                  }
               }

               foundry.utils.setProperty(this._draft, el.dataset.llPath, val)
               this.render(true)
            })
         })
   }

   _bindRuleJsonInput(textarea) {
      const path = textarea.dataset.llPath
      const wrapper = textarea.closest(".ll-effect__rule")
      const statusEl = wrapper?.querySelector("[data-ll-rule-status]")
      const labelEl = wrapper?.querySelector(".ll-effect__rule-label")

      const updateStatus = () => {
         const val = textarea.value
         const result = _validateRuleJson(val)
         if (statusEl) {
            if (result.valid) {
               statusEl.innerHTML = `<i class="fas fa-check"></i> Valid`
               statusEl.className = "ll-effect__rule-status is-valid"
               if (labelEl) labelEl.textContent = `Rule: ${result.parsed.key}`
            } else {
               statusEl.innerHTML = `<i class="fas fa-xmark"></i> ${result.error}`
               statusEl.className = "ll-effect__rule-status is-invalid"
            }
         }
      }

      updateStatus()

      let debounceTimer = null
      textarea.addEventListener("input", () => {
         if (!this._draft) return
         clearTimeout(debounceTimer)
         debounceTimer = setTimeout(() => {
            foundry.utils.setProperty(this._draft, path, textarea.value)
            updateStatus()
         }, 250)
      })

      textarea.addEventListener("change", () => {
         if (!this._draft) return
         clearTimeout(debounceTimer)
         foundry.utils.setProperty(this._draft, path, textarea.value)
         updateStatus()
      })
   }

   _bindRuleDescriptionInput(input) {
      const path = input.dataset.llPath
      let debounceTimer = null
      input.addEventListener("input", () => {
         if (!this._draft) return
         clearTimeout(debounceTimer)
         debounceTimer = setTimeout(() => {
            foundry.utils.setProperty(this._draft, path, input.value)
         }, 250)
      })
      input.addEventListener("change", () => {
         if (!this._draft) return
         clearTimeout(debounceTimer)
         foundry.utils.setProperty(this._draft, path, input.value)
      })
   }

   static async _onCreateCategory(_event, _target) {
      const cat = await createCategory()

      cat.description = ""
      cat.acute = {
         intoxStages: [1, 2, 3].map((i) => ({
            tox: 0,
            label: `Stage ${toRoman(i)}`,
            description: "",
            decay: { amount: 0, per: { value: 1, unit: "hours" } },
            payload: { formula: "", damageType: "poison" },
            effects: [],
         })),
         overdose: {
            threshold: 0,
            dc: 15,
            rollOptions: "",
            description: "",
            duration: { value: 1, unit: "hours" },
            criticalSuccess: {
               reduceToxicity: true,
               reduceAmount: 2,
               payload: { formula: "", damageType: "poison" },
               effects: [],
            },
            success: {
               reduceToxicity: true,
               reduceAmount: 1,
               payload: { formula: "", damageType: "poison" },
               effects: [],
            },
            failure: {
               payload: { formula: "", damageType: "poison" },
               effects: [],
            },
            criticalFailure: {
               payload: { formula: "", damageType: "poison" },
               effects: [],
            },
         },
         hangover: {
            enabled: false,
            threshold: 0,
            dc: 15,
            rollOptions: "",
            description: "",
            duration: { value: 1, unit: "hours" },
            failure: { effects: [] },
            criticalFailure: { effects: [] },
         },
      }
      cat.chronic = {
         baseWillDC: 0,
         addictionStages: [1, 2, 3].map((i) => ({
            apThreshold: 0,
            label: `Stage ${toRoman(i)}`,
            description: "",
            maxTolerance: 0,
            willPenalty: 0,
            quitPenalty: 0,
            apDecayAmount: 0,
            apDecayPer: { value: 1, unit: "days" },
            satiation: { value: 1, unit: "hours" },
            chronicEffects: [],
            withdrawalEffects: [],
         })),
      }

      await updateCategory(cat.id, cat)

      this._selectedId = cat.id
      this._draft = null
      this.render(true)
   }

   static async _onDeleteCategory(event, target) {
      if (this.isDirty) {
         ui.notifications?.warn(
            game.i18n.localize("LL.Registry.WarnUnsavedDelete"),
         )
         return
      }
      const categoryId = target.dataset.categoryId
      const cat = getCategory(categoryId)
      if (!cat) {
         ui.notifications?.warn(
            game.i18n.localize("LL.Registry.WarnSelectDelete"),
         )
         return
      }

      const content = game.i18n.format("LL.Registry.DeleteConfirm", {
         categoryName: cat.name,
      })

      const confirm = await DialogV2.confirm({
         window: { title: game.i18n.localize("LL.Registry.DeleteTitle") },
         content,
         yes: {
            label: game.i18n.localize("LL.Registry.DeleteYes"),
            icon: "fas fa-trash",
         },
         rejectClose: false,
      })
      if (confirm) {
         await deleteCategory(categoryId)
         if (this._selectedId === categoryId) {
            this._selectedId = null
            this._draft = null
         }
         this.render(true)
      }
   }

   static _onSelectCategory(_event, target) {
      const id = target.dataset.categoryId
      if (this._selectedId === id) return
      if (this._isDirty()) {
         ui.notifications?.warn("Unsaved changes discarded.")
      }
      this._selectedId = id
      this._draft = null
      this.render(true)
   }

   static async _onSaveCategory() {
      if (!this._selectedId || !this._draft) return

      const ruleErrors = _collectRuleErrors(this._draft)
      if (ruleErrors.length > 0) {
         const summary = ruleErrors
            .slice(0, 3)
            .map((e) => `• ${e.location}: ${e.error}`)
            .join("\n")
         const more =
            ruleErrors.length > 3
               ? `\n…and ${ruleErrors.length - 3} more.`
               : ""
         ui.notifications?.error(
            `Cannot save: invalid rule element(s).\n${summary}${more}`,
            { permanent: true },
         )
         return
      }

      this._saveViewState()
      this._scrollToTopOnNextRender = true

      await updateCategory(this._selectedId, this._draft)
      ui.notifications?.info(
         game.i18n.format("LL.Registry.CategorySaved", {
            categoryName: this._draft.name,
         }),
      )
      this.render(true)
   }

   static async _onExportCategory() {
      if (!this._selectedId) return
      const json = exportCategory(this._selectedId)
      downloadJson(
         json,
         `category_${this._draft.name.replace(/\\s+/g, "_")}.json`,
      )
   }

   static async _onExportAllCategories() {
      const json = exportAllCategories()
      downloadJson(json, `ll_categories_all.json`)
   }

   static async _onImportCategory() {
      try {
         const json = await pickJsonFile()
         if (!json) return
         await importCategoryJson(json)
         ui.notifications?.info(game.i18n.localize("LL.Registry.ImportSuccess"))
         this.render(true)
      } catch (err) {
         ui.notifications?.error(
            game.i18n.format("LL.Registry.ImportFailed", {
               message: err.message,
            }),
         )
      }
   }

   static async _onPickIcon(_event, _target) {
      if (!this._draft) return
      const FP =
         foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker
      new FP({
         type: "image",
         current: this._draft.img,
         callback: (chosen) => {
            this._saveViewState()
            this._draft.img = chosen
            this.render(true)
         },
      }).render(true)
   }

   static _onAddIntoxStage() {
      this._saveViewState()
      const stageNum = this._draft.acute.intoxStages.length + 1
      this._draft.acute.intoxStages.push({
         tox: 0,
         label: `Stage ${toRoman(stageNum)}`,
         description: "",
         decay: { amount: 0, per: { value: 1, unit: "hours" } },
         payload: { formula: "", damageType: "poison" },
         effects: [],
      })
      this.render(true)
   }

   static _onRemoveIntoxStage(_event, target) {
      this._saveViewState()
      const idx = Number(target.dataset.index)
      this._draft.acute.intoxStages.splice(idx, 1)
      this.render(true)
   }

   static _onAddAddictionStage() {
      this._saveViewState()
      const stageNum = this._draft.chronic.addictionStages.length + 1
      this._draft.chronic.addictionStages.push({
         apThreshold: 0,
         label: `Stage ${toRoman(stageNum)}`,
         description: "",
         maxTolerance: 0,
         willPenalty: 0,
         quitPenalty: 0,
         apDecayAmount: 0,
         apDecayPer: { value: 1, unit: "days" },
         satiation: { value: 1, unit: "hours" },
         chronicEffects: [],
         withdrawalEffects: [],
      })
      this.render(true)
   }

   static _onRemoveAddictionStage(_event, target) {
      this._saveViewState()
      const idx = Number(target.dataset.index)
      this._draft.chronic.addictionStages.splice(idx, 1)
      this.render(true)
   }

   static _onAddEffectCondition(_event, target) {
      this._saveViewState()
      const path = target.dataset.path
      const arr = foundry.utils.getProperty(this._draft, path) ?? []
      arr.push({ type: "condition", slug: "sickened", value: 1 })
      foundry.utils.setProperty(this._draft, path, arr)
      this.render(true)
   }

   static _onAddEffectUuid(_event, target) {
      this._saveViewState()
      const path = target.dataset.path
      const arr = foundry.utils.getProperty(this._draft, path) ?? []
      arr.push({ type: "uuid", uuid: "" })
      foundry.utils.setProperty(this._draft, path, arr)
      this.render(true)
   }

   static _onAddEffectRule(_event, target) {
      this._saveViewState()
      const path = target.dataset.path
      const arr = foundry.utils.getProperty(this._draft, path) ?? []
      arr.push({
         type: "rule",
         ruleJson: '{\n   "key": "FlatModifier"\n}',
      })
      foundry.utils.setProperty(this._draft, path, arr)
      this.render(true)
   }

   static _onRemoveEffect(_event, target) {
      this._saveViewState()
      const path = target.dataset.path
      const idx = Number(target.dataset.index)
      const arr = foundry.utils.getProperty(this._draft, path)
      if (Array.isArray(arr)) {
         arr.splice(idx, 1)
         this.render(true)
      }
   }

   static _onOpenEffect(_event, target) {
      const uuid = target.dataset.uuid
      if (uuid) fromUuid(uuid).then((doc) => doc?.sheet?.render(true))
   }
}

function _normalizeDraft(draft) {
   if (!draft || typeof draft !== "object") return

   const ensurePayload = (obj) => {
      if (!obj.payload || typeof obj.payload !== "object") {
         obj.payload = { formula: "", damageType: "poison" }
         return
      }
      if (typeof obj.payload.damageType !== "string" || !obj.payload.damageType) {
         obj.payload.damageType = "poison"
      }
      if (typeof obj.payload.formula !== "string") obj.payload.formula = ""
   }

   const ensureEffects = (obj) => {
      if (!Array.isArray(obj.effects)) obj.effects = []
   }

   const acute = draft.acute ?? (draft.acute = {})

   if (Array.isArray(acute.intoxStages)) {
      for (const stage of acute.intoxStages) {
         if (!stage || typeof stage !== "object") continue
         ensurePayload(stage)
         ensureEffects(stage)
      }
   }

   const od = acute.overdose ?? (acute.overdose = {})
   if (typeof od.dc !== "number") od.dc = 15
   if (!od.duration) od.duration = { value: 1, unit: "hours" }

   const odBranch = (key, defaults) => {
      if (!od[key] || typeof od[key] !== "object") od[key] = { ...defaults }
      ensurePayload(od[key])
      ensureEffects(od[key])
   }
   odBranch("criticalSuccess", { reduceToxicity: true, reduceAmount: 2 })
   odBranch("success", { reduceToxicity: true, reduceAmount: 1 })
   odBranch("failure", {})
   odBranch("criticalFailure", {})

   const hg = acute.hangover ?? (acute.hangover = {})
   if (typeof hg.dc !== "number") hg.dc = 15
   if (!hg.duration) hg.duration = { value: 1, unit: "hours" }
   if (!hg.failure || typeof hg.failure !== "object") hg.failure = {}
   ensureEffects(hg.failure)
   if (!hg.criticalFailure || typeof hg.criticalFailure !== "object")
      hg.criticalFailure = {}
   ensureEffects(hg.criticalFailure)

   const chronic = draft.chronic ?? (draft.chronic = {})
   if (Array.isArray(chronic.addictionStages)) {
      for (const stage of chronic.addictionStages) {
         if (!stage || typeof stage !== "object") continue
         if (!Array.isArray(stage.chronicEffects)) stage.chronicEffects = []
         if (!Array.isArray(stage.withdrawalEffects))
            stage.withdrawalEffects = []
         const wp = Number(stage.willPenalty)
         if (Number.isFinite(wp) && wp < 0) stage.willPenalty = -wp
         const qp = Number(stage.quitPenalty)
         if (Number.isFinite(qp) && qp < 0) stage.quitPenalty = -qp
      }
   }
}

function _resolveEffectNames(node, uuidCache = null) {
   if (!node) return
   if (uuidCache === null) uuidCache = new Map()
   if (Array.isArray(node)) {
      for (const item of node) {
         if (item.type === "uuid") {
            if (item.uuid) {
               let doc
               if (uuidCache.has(item.uuid)) {
                  doc = uuidCache.get(item.uuid)
               } else {
                  doc = fromUuidSync(item.uuid)
                  uuidCache.set(item.uuid, doc)
               }
               if (doc && doc.type === "effect") {
                  item.resolvedName = doc.name
                  item.img = doc.img
               } else {
                  item.resolvedName = null
                  item.img = null
               }
            } else {
               item.resolvedName = null
               item.img = null
            }
         } else if (item.type === "condition") {
            const condItem = game.pf2e?.ConditionManager?.getCondition(
               item.slug,
            )
            item.img =
               condItem?.img || "systems/pf2e/icons/conditions/default.webp"
            item.valued = VALUED_CONDITIONS.has(item.slug)
         } else if (item.type === "rule") {
            if (item.ruleData && !item.ruleJson) {
               try {
                  item.ruleJson = JSON.stringify(item.ruleData, null, 3)
               } catch (_e) {
                  item.ruleJson = ""
               }
            }
            const parsed = _tryParseRule(item.ruleJson)
            item.ruleLabel = parsed?.key
               ? `Rule: ${parsed.key}`
               : "Rule Element"
         }
         _resolveEffectNames(item, uuidCache)
      }
   } else if (typeof node === "object") {
      for (const v of Object.values(node)) {
         _resolveEffectNames(v, uuidCache)
      }
   }
}

function _tryParseRule(jsonText) {
   if (typeof jsonText !== "string") return null
   const t = jsonText.trim()
   if (!t) return null
   try {
      const parsed = JSON.parse(t)
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

function _validateRuleJson(jsonText) {
   if (typeof jsonText !== "string" || !jsonText.trim()) {
      return { valid: false, error: "Empty rule" }
   }
   let parsed
   try {
      parsed = JSON.parse(jsonText)
   } catch (e) {
      return { valid: false, error: e.message }
   }
   if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { valid: false, error: "Rule must be a JSON object" }
   }
   if (typeof parsed.key !== "string" || !parsed.key) {
      return { valid: false, error: "Rule must have a non-empty 'key' string" }
   }
   return { valid: true, parsed }
}

function _collectRuleErrors(draft) {
   const errors = []
   const visit = (node, path) => {
      if (!node) return
      if (Array.isArray(node)) {
         node.forEach((item, idx) => visit(item, `${path}[${idx}]`))
         return
      }
      if (typeof node !== "object") return
      if (node.type === "rule") {
         const result = _validateRuleJson(node.ruleJson)
         if (!result.valid) errors.push({ location: path, error: result.error })
         return
      }
      for (const [key, val] of Object.entries(node)) {
         if (key === "ruleJson" || key === "ruleData") continue
         visit(val, path ? `${path}.${key}` : key)
      }
   }
   visit(draft, "")
   return errors
}

function _activateDropZones(html, app) {
   const zones = html.querySelectorAll(".ll-effects")
   zones.forEach((zone) => {
      zone.addEventListener("dragenter", (ev) => {
         ev.preventDefault()
         zone.classList.add("is-drop-hover")
      })
      zone.addEventListener("dragleave", (ev) => {
         ev.preventDefault()
         if (!zone.contains(ev.relatedTarget)) {
            zone.classList.remove("is-drop-hover")
         }
      })
      zone.addEventListener("dragover", (ev) => ev.preventDefault())
      zone.addEventListener("drop", async (ev) => {
         ev.preventDefault()
         zone.classList.remove("is-drop-hover")
         const path = zone.dataset.effectsPath
         if (!path) return

         if (!app || !app._draft) return

         try {
            const data = JSON.parse(ev.dataTransfer.getData("text/plain"))
            if (!data.uuid) return

            app._saveViewState()

            const item = await fromUuid(data.uuid).catch(() => null)
            if (!item) return

            const arr = foundry.utils.getProperty(app._draft, path) ?? []
            if (item.type === "condition") {
               arr.push({
                  type: "condition",
                  slug: item.system.slug || item.slug || "sickened",
                  value: item.system.value?.value || 1,
                  img: item.img,
               })
            } else if (item.type === "effect") {
               arr.push({
                  type: "uuid",
                  uuid: data.uuid,
                  resolvedName: item.name,
                  img: item.img,
               })
            } else {
               ui.notifications?.error(
                  game.i18n.localize("LL.Registry.DropError"),
               )
               return
            }

            foundry.utils.setProperty(app._draft, path, arr)
            app.render(true)
         } catch (e) {
            console.error("Logan's Loophole drop error", e)
         }
      })
   })
}
