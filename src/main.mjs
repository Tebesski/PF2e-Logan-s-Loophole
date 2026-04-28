import { MODULE_ID, PHASE, canEditRegistry } from "./constants.mjs"
import { registerSettings, Settings } from "./settings.mjs"
import { registerHandlebarsHelpers } from "./utils/handlebars.mjs"
import { registerTimeKeeper } from "./hooks/timeKeeper.mjs"
import { registerRestHook } from "./hooks/restHook.mjs"
import { registerItemSheetHook } from "./sheets/itemSheet.mjs"
import { registerActorSheetHook } from "./sheets/actorSheet.mjs"
import { onConsumeItem } from "./hooks/consumeItem.mjs"
import { CategoryRegistryApp } from "./apps/categoryRegistryApp.mjs"
import { importCategoryJson } from "./utils/portability.mjs"
import { api } from "./api.mjs"

Hooks.once("init", () => {
   registerSettings()
   registerHandlebarsHelpers()
   loadTemplates([
      `modules/${MODULE_ID}/templates/registry-app.hbs`,
      `modules/${MODULE_ID}/templates/partial-effects.hbs`,
      `modules/${MODULE_ID}/templates/partial-info.hbs`,
      `modules/${MODULE_ID}/templates/item-drug-tab.hbs`,
      `modules/${MODULE_ID}/templates/item-summary.hbs`,
      `modules/${MODULE_ID}/templates/actor-hud.hbs`,
      `modules/${MODULE_ID}/templates/sound-settings-app.hbs`,
      `modules/${MODULE_ID}/templates/intent-prompt.hbs`,
      `modules/${MODULE_ID}/templates/chat-addiction-check.hbs`,
      `modules/${MODULE_ID}/templates/chat-overdose.hbs`,
   ])
})

Hooks.once("setup", () => {
   registerItemSheetHook()
   registerActorSheetHook()
   registerTimeKeeper()
   registerRestHook()
})

Hooks.once("ready", () => {
   const mod = game.modules.get(MODULE_ID)
   if (mod) mod.api = api
   _seedDefaultCategoriesIfNeeded()
})

async function _seedDefaultCategoriesIfNeeded() {
   if (!game.user.isGM) return
   try {
      const hasSeeded = game.settings.get(MODULE_ID, "hasSeededDefaults")
      if (hasSeeded) return
      const reg = game.settings.get(MODULE_ID, "registry") ?? { categories: {} }
      const existing = Object.keys(reg.categories ?? {}).length
      if (existing > 0) {
         await game.settings.set(MODULE_ID, "hasSeededDefaults", true)
         return
      }
      const url = `modules/${MODULE_ID}/assets/defaults/categories.json`
      const res = await fetch(url)
      if (!res.ok) {
         console.warn(
            `${MODULE_ID} | could not fetch default categories: HTTP ${res.status}`,
         )
         return
      }
      const json = await res.text()
      const result = await importCategoryJson(json)
      await game.settings.set(MODULE_ID, "hasSeededDefaults", true)
      ui.notifications?.info(
         `Logan's Loophole: imported ${result.imported} default categor${
            result.imported === 1 ? "y" : "ies"
         }.`,
      )
      if (result.errors?.length) {
         for (const e of result.errors) console.warn(`${MODULE_ID} | ${e}`)
      }
   } catch (err) {
      console.error(`${MODULE_ID} | failed to seed default categories:`, err)
   }
}

const _recentlyProcessed = new Set()
function _alreadyProcessed(actor, item) {
   const key = `${actor.id}|${item.id}`
   if (_recentlyProcessed.has(key)) return true
   _recentlyProcessed.add(key)
   setTimeout(() => _recentlyProcessed.delete(key), 500)
   return false
}

function _wireDirectConsumptionHooks() {
   const candidateHookNames = ["pf2e.itemUsed", "pf2e.useItem", "useItem"]
   for (const name of candidateHookNames) {
      Hooks.on(name, async (...args) => {
         let actor, item
         if (args[0]?.type === "consumable" && args[0]?.actor) {
            item = args[0]
            actor = item.actor
         } else if (args[0]?.documentName === "Actor") {
            actor = args[0]
            item = args[1]
         } else if (args[1]?.type === "consumable") {
            item = args[1]
            actor = args[0] ?? item.actor
         }
         if (!item || item.type !== "consumable") return
         if (!actor) return
         if (!actor.isOwner) return
         if (_alreadyProcessed(actor, item)) return
         try {
            await onConsumeItem(actor, item, null)
         } catch (err) {
            console.error(`${MODULE_ID} | consumeItem direct-hook error:`, err)
         }
      })
   }
}
Hooks.once("ready", () => _wireDirectConsumptionHooks())

Hooks.on("createChatMessage", async (message) => {
   if (!message.isAuthor) return

   const originUuid = _extractConsumableOriginUuid(message)
   if (!originUuid) return

   const actor = message.actor
   if (!actor) return
   try {
      const item = await fromUuid(originUuid)
      if (!item || item.type !== "consumable") return
      if (_alreadyProcessed(actor, item)) return
      await onConsumeItem(actor, item, message)
   } catch (err) {
      console.error(`${MODULE_ID} | consumeItem handler error:`, err)
   }
})

function _extractConsumableOriginUuid(message) {
   const pf2e = message.flags?.pf2e
   if (!pf2e) return null
   if (pf2e.origin?.uuid) return pf2e.origin.uuid
   if (pf2e.context?.item && typeof pf2e.context.item === "string") {
      return pf2e.context.item.includes(".") ? pf2e.context.item : null
   }
   return null
}

const LOCKED_PHASES = [
   PHASE.PERMANENT,
   PHASE.WITHDRAWAL,
   PHASE.OVERDOSE,
   PHASE.INTOXICATION,
   PHASE.HANGOVER,
   PHASE.IMMUNITY,
]

Hooks.on("preDeleteItem", (item, options, _userId) => {
   if (options?.logansLoophole) return true

   const actor = item.parent
   const blockedId = actor?._llBlockingCascadeFor
   if (blockedId) {
      if (item.id === blockedId) return false
      if (_isDescendantOf(item, blockedId)) return false
   }

   const f = item.flags?.[MODULE_ID]
   if (f?.managed && LOCKED_PHASES.includes(f.phase)) {
      if (_wrapperHasExpired(item)) return true
      if (actor) actor._llBlockingCascadeFor = item.id
      _promptWrapperDeletion(item, f)
      return false
   }

   const granterChain = _findManagedGranter(item)
   if (granterChain) {
      const { granter, flags } = granterChain
      if (_wrapperHasExpired(granter)) return true
      if (actor) actor._llBlockingCascadeFor = granter.id
      _promptWrapperDeletion(granter, flags)
      return false
   }

   return true
})

function _isDescendantOf(item, ancestorId) {
   let current = item
   const visited = new Set()
   while (current) {
      const grantedBy = current.flags?.pf2e?.grantedBy
      const id = typeof grantedBy === "string" ? grantedBy : grantedBy?.id
      if (!id || visited.has(id)) return false
      if (id === ancestorId) return true
      visited.add(id)
      current = current.parent?.items?.get(id) ?? null
   }
   return false
}

function _findManagedGranter(item) {
   let current = item
   const visited = new Set()
   while (current) {
      const grantedBy = current.flags?.pf2e?.grantedBy
      const id = typeof grantedBy === "string" ? grantedBy : grantedBy?.id
      if (!id || visited.has(id)) return null
      visited.add(id)
      const granter = item.parent?.items?.get(id)
      if (!granter) return null
      const f = granter.flags?.[MODULE_ID]
      if (f?.managed) return { granter, flags: f }
      current = granter
   }
   return null
}

function _wrapperHasExpired(item) {
   const dur = item?.system?.duration
   if (!dur) return false
   if (dur.unit === "unlimited" || !dur.value || dur.value < 0) return false
   const start = Number(item?.system?.start?.value)
   if (!Number.isFinite(start)) return false
   const unitSec =
      { rounds: 6, minutes: 60, hours: 3600, days: 86400 }[dur.unit] ?? 0
   if (unitSec <= 0) return false
   const endsAt = start + dur.value * unitSec
   return endsAt <= game.time.worldTime
}

async function _promptWrapperDeletion(item, flags) {
   const { DialogV2 } = foundry.applications.api
   const actor = item.parent
   if (!actor) return

   if (actor._llPromptingDeletion) return
   actor._llPromptingDeletion = true
   actor._llBlockingCascadeFor = item.id

   try {
      const catId = flags.category
      const phase = flags.phase

      let actionText = "remove this effect"
      if (phase === PHASE.INTOXICATION)
         actionText =
            game.i18n.localize("LL.Dialog.Manage.Action.Intoxication") ||
            "reduce the Intoxication stage"
      else if (phase === PHASE.PERMANENT)
         actionText =
            game.i18n.localize("LL.Dialog.Manage.Action.Addiction") ||
            "reduce the Addiction stage"
      else if (phase === PHASE.WITHDRAWAL)
         actionText =
            game.i18n.localize("LL.Dialog.Manage.Action.Withdrawal") ||
            "satiate the addiction (removes withdrawal)"
      else if (phase === PHASE.OVERDOSE)
         actionText =
            game.i18n.localize("LL.Dialog.Manage.Action.Overdose") ||
            "cure the Overdose"
      else if (phase === PHASE.HANGOVER)
         actionText =
            game.i18n.localize("LL.Dialog.Manage.Action.Hangover") ||
            "cure the Hangover"
      else if (phase === PHASE.IMMUNITY)
         actionText =
            game.i18n.localize("LL.Dialog.Manage.Action.Immunity") ||
            "clear the Immunity"

      const content = `
         <p>${game.i18n.localize("LL.Dialog.Manage.Body1") || "You are attempting to manually delete a Logan's Loophole wrapper effect."}</p>
         <p>${game.i18n.format("LL.Dialog.Manage.Body2", { action: actionText }) || `Do you want to <strong>${actionText}</strong> for this character?`}</p>
      `

      const choice = await DialogV2.confirm({
         window: {
            title:
               game.i18n.localize("LL.Dialog.Manage.Title") ||
               "Manage Addiction State",
         },
         content,
         rejectClose: false,
      })

      if (choice) {
         const api = game.modules.get(MODULE_ID)?.api
         if (!api) return

         if (phase === PHASE.INTOXICATION) {
            const state = api.getState(actor, catId)
            const cat = api.getCategory(catId)
            const currentTox = Number(state.toxicity) || 0
            const stages = cat.acute?.intoxStages ?? []
            let next = 0
            for (let i = stages.length - 1; i >= 0; i--) {
               if (stages[i].tox < currentTox) {
                  next = stages[i].tox
                  break
               }
            }
            await api.setToxicity(actor, catId, next)
         } else if (phase === PHASE.PERMANENT) {
            const state = api.getState(actor, catId)
            const currentStage = Number(state.addictionStage) || 0
            await api.forceStage(actor, catId, Math.max(0, currentStage - 1))
         } else if (phase === PHASE.WITHDRAWAL) {
            await api.forceSatiate(actor, catId)
         } else if (phase === PHASE.OVERDOSE) {
            await api.cureOverdose(actor, catId)
         } else if (phase === PHASE.HANGOVER) {
            await api.cureHangover(actor, catId)
         } else if (phase === PHASE.IMMUNITY) {
            const updateData = {}
            updateData[`flags.${MODULE_ID}.immunity.${catId}`] = null
            await actor.update(updateData)
            await item.delete({ logansLoophole: true })
         }
      }
   } finally {
      delete actor._llPromptingDeletion
      delete actor._llBlockingCascadeFor
   }
}

Hooks.on("renderSceneControls", (app, html) => {
   if (!canEditRegistry()) return
   if (!Settings.showSceneControlButton) return

   const root = html instanceof HTMLElement ? html : html[0]
   if (!root) return

   const menu =
      root.tagName === "MENU" && root.id === "scene-controls-layers"
         ? root
         : root.querySelector("#scene-controls-layers") ||
           root.querySelector(".main-controls")

   if (!menu) return
   if (menu.querySelector(".ll-custom-scene-btn")) return

   const li = document.createElement("li")
   li.className = "ll-custom-scene-btn"

   const tooltip = game.i18n.localize("LL.SceneControl.Tooltip")
   const aria = game.i18n.localize("LL.SceneControl.AriaLabel")
   li.innerHTML = `
      <button type="button" class="control ui-control layer icon fas fa-flask" data-tooltip="${tooltip}" aria-label="${aria}"></button>
   `

   li.addEventListener("click", (ev) => {
      ev.preventDefault()
      ev.stopPropagation()
      new CategoryRegistryApp().render(true)
   })

   menu.appendChild(li)
})
