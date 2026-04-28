import {
   MODULE_ID,
   STATE,
   PHASE,
   IMMUNITY_ASPECTS,
   canUseHudControls,
} from "../constants.mjs"
import {
   getCategory,
   listCategories,
   addictionStageConfig,
} from "../registry/registry.mjs"
import {
   getStateMap,
   getState,
   toSeconds,
   isFutureTimestamp,
} from "../utils/state.mjs"
import { api } from "../api.mjs"

export function registerActorSheetHook() {
   Hooks.on("renderActorSheet", _onRender)
   Hooks.on("renderActorSheetV2", _onRender)
}

function _toDomElement(html) {
   if (!html) return null
   if (html instanceof HTMLElement) return html
   if (html[0] instanceof HTMLElement) return html[0]
   if (typeof html.get === "function") {
      const el = html.get(0)
      if (el instanceof HTMLElement) return el
   }
   return null
}

function _formatTime(seconds) {
   if (seconds <= 0) return "0m"
   const d = Math.floor(seconds / 86400)
   const h = Math.floor((seconds % 86400) / 3600)
   const m = Math.floor((seconds % 3600) / 60)
   const parts = []
   if (d > 0) parts.push(`${d}d`)
   if (h > 0) parts.push(`${h}h`)
   if (m > 0) parts.push(`${m}m`)
   if (parts.length === 0) return "< 1m"
   return parts.join(" ")
}

function _onRender(sheet, html, _data) {
   const actor = sheet.actor ?? sheet.document
   if (!actor) return
   if (actor.type !== "character" && actor.type !== "npc") return

   const root = _toDomElement(html)
   if (!root) return

   const effectsTab =
      root.querySelector(".tab.effects[data-tab='effects']") ||
      root.querySelector(".sheet-content .tab[data-tab='effects']")
   if (!effectsTab) return

   if (
      effectsTab.querySelector(".ll-hud-container") ||
      effectsTab.querySelector(".ll-hud-header")
   )
      return

   const map = getStateMap(actor)
   const rows = []

   for (const [categoryId, _state] of Object.entries(map)) {
      const cat = getCategory(categoryId)
      if (!cat) {
         rows.push({
            categoryId,
            unbound: true,
            categoryName: _state[STATE.CATEGORY_NAME] || categoryId,
            categoryImg:
               _state[STATE.CATEGORY_IMG] || "icons/svg/mystery-man.svg",
         })
         continue
      }
      rows.push(_buildRow(actor, categoryId, cat))
   }

   const context = {
      rows,
      isGM: game.user.isGM,
      canControl: canUseHudControls(),
   }

   const tplPath = `modules/${MODULE_ID}/templates/actor-hud.hbs`
   const templateFn =
      Handlebars.partials[tplPath] ?? window.Handlebars?.templates?.[tplPath]
   if (!templateFn) return
   const tabContent = templateFn(context, {
      allowProtoMethodsByDefault: true,
      allowProtoPropertiesByDefault: true,
   })

   const header = document.createElement("header")
   header.className = "ll-hud-header"
   header.dataset.groupId = "addictions"
   header.innerText = game.i18n.localize("LL.HUD.AddictionsHeader")

   const container = document.createElement("div")
   container.className = "ll-hud-container"
   container.innerHTML = tabContent

   const scrollTarget =
      effectsTab.closest(".sheet-body") ||
      effectsTab.closest(".sheet-content") ||
      effectsTab
   const savedScrollTop = scrollTarget.scrollTop

   effectsTab.appendChild(header)
   effectsTab.appendChild(container)

   requestAnimationFrame(() => {
      scrollTarget.scrollTop = savedScrollTop
   })

   if (sheet.isEditable !== false && canUseHudControls())
      _activateListeners(container, actor)
}

function _buildRow(actor, categoryId, cat) {
   const s = getState(actor, categoryId)
   const toxicity = Number(s[STATE.TOXICITY]) || 0
   const tolerance = Number(s[STATE.TOLERANCE]) || 0
   const ap = Number(s[STATE.ADDICTION_POINTS]) || 0
   const stageNum = Number(s[STATE.ADDICTION_STAGE]) || 0
   const peakStage = Number(s[STATE.PEAK_STAGE]) || 0
   const now = game.time.worldTime

   const allImmunities = actor.getFlag(MODULE_ID, "immunity") || {}
   const isSeparate = game.settings.get(
      MODULE_ID,
      "separateAddictionImmunities",
   )

   const immunities = {}
   if (isSeparate) {
      Object.assign(immunities, allImmunities[categoryId] || {})
   } else {
      for (const catObj of Object.values(allImmunities)) {
         for (const [asp, expireTime] of Object.entries(catObj || {})) {
            if (typeof expireTime === "number") {
               if (
                  immunities[asp] === undefined ||
                  expireTime > immunities[asp]
               ) {
                  immunities[asp] = expireTime
               }
            }
         }
      }
   }

   let hasImmunity = false
   let maxTimeLeft = 0

   const generalAspects = IMMUNITY_ASPECTS.filter(
      (asp) => !game.settings.get(MODULE_ID, `immunityToggle_${asp}`),
   )

   const activeAspects = []

   IMMUNITY_ASPECTS.forEach((asp) => {
      const expireTime = immunities[asp]
      if (typeof expireTime === "number" && expireTime > now) {
         hasImmunity = true
         const timeLeft = expireTime - now
         if (timeLeft > maxTimeLeft) maxTimeLeft = timeLeft
         activeAspects.push({
            asp,
            timeLeft,
            isGeneral: generalAspects.includes(asp),
         })
      }
   })

   let immunityLabel = ""
   if (hasImmunity) {
      const allActive =
         activeAspects.length === IMMUNITY_ASPECTS.length &&
         activeAspects.every((a) => a.timeLeft === activeAspects[0].timeLeft)

      if (allActive) {
         immunityLabel = `${_formatTime(maxTimeLeft)} ${game.i18n.localize("LL.Immunity.All")}`
      } else {
         const generalActive = activeAspects.filter((a) => a.isGeneral)
         const specificActive = activeAspects.filter((a) => !a.isGeneral)

         const parts = []

         if (generalActive.length > 0) {
            const sameTime = generalActive.every(
               (a) => a.timeLeft === generalActive[0].timeLeft,
            )
            if (sameTime) {
               const label =
                  generalActive.length === generalAspects.length
                     ? game.i18n.localize("LL.Immunity.General")
                     : game.i18n.localize("LL.Immunity.GeneralPartial")
               parts.push(`${label} [${_formatTime(generalActive[0].timeLeft)}]`)
            } else {
               for (const a of generalActive) {
                  const aspCap = a.asp.charAt(0).toUpperCase() + a.asp.slice(1)
                  const label =
                     game.i18n.localize(`LL.Immunity.Aspect${aspCap}`) || aspCap
                  parts.push(`${label} [${_formatTime(a.timeLeft)}]`)
               }
            }
         }

         for (const a of specificActive) {
            const aspCap = a.asp.charAt(0).toUpperCase() + a.asp.slice(1)
            const label =
               game.i18n.localize(`LL.Immunity.Aspect${aspCap}`) || aspCap
            parts.push(`${label} [${_formatTime(a.timeLeft)}]`)
         }

         immunityLabel = parts.join(", ")
      }
   }

   const stgCfg = addictionStageConfig(cat, stageNum)
   let maxTol = stgCfg?.maxTolerance ?? 0

   if (game.settings.get(MODULE_ID, "useConTolerance")) {
      const onlyAddicted = game.settings.get(
         MODULE_ID,
         "conToleranceAddictedOnly",
      )
      if (!onlyAddicted || stageNum > 0) {
         const conMod =
            actor.system?.abilities?.con?.mod ??
            actor.system?.attributes?.constitution?.modifier ??
            0
         if (conMod > 0) maxTol += conMod
      }
   }

   const tolPips = []
   for (let i = 0; i < maxTol; i++) tolPips.push(i < tolerance)

   const nextCfg = addictionStageConfig(cat, stageNum + 1)
   const nextThreshold = nextCfg?.apThreshold ?? null

   let apPercent = 0
   if (nextThreshold && nextThreshold > 0) {
      const base = stgCfg?.apThreshold ?? 0
      const progress = Math.max(0, ap - base)
      const span = nextThreshold - base
      apPercent = Math.min(
         100,
         Math.max(0, Math.round((progress / span) * 100)),
      )
   } else if (stageNum > 0) {
      apPercent = 100
   }

   const isMaxAddiction = stageNum > 0 && !nextThreshold
   const showApBar = (nextThreshold && nextThreshold > 0) || isMaxAddiction

   let isSatiated = false
   let satiatedTimeLabel = ""
   let decayLabel = ""
   let withdrawalStage = Number(s[STATE.WITHDRAWAL_STAGE]) || 0
   let isApPaused = false
   let apPausedTimeLabel = ""

   if (ap > 0) {
      const rawSat = s[STATE.SATIATION_END]
      const satEnd = Number(rawSat) || 0
      const effCfg = addictionStageConfig(cat, Math.max(1, stageNum))

      const rawPause = s[STATE.AP_DECAY_PAUSE_END]
      const pauseEnd = Number(rawPause) || 0
      if (isFutureTimestamp(rawPause, now)) {
         isApPaused = true
         apPausedTimeLabel = _formatTime(pauseEnd - now)
      }

      if (isFutureTimestamp(rawSat, now)) {
         isSatiated = true
         satiatedTimeLabel = `[${_formatTime(satEnd - now)}]`
      } else if (effCfg) {
         if (stageNum > 0 && withdrawalStage === 0) withdrawalStage = stageNum
         const amt = effCfg?.apDecayAmount ?? 0
         const perVal = effCfg?.apDecayPer?.value ?? 1
         const perUnit = effCfg?.apDecayPer?.unit ?? "days"
         decayLabel = `${amt} AP / ${perVal} ${perUnit}`
      }
   }

   const intoxStages = cat.acute?.intoxStages ?? []
   let intoxLabel = game.i18n.localize("LL.HUD.Sober")
   let intoxIdx = -1
   for (let i = 0; i < intoxStages.length; i++) {
      if (toxicity >= (intoxStages[i]?.tox ?? Infinity)) {
         intoxIdx = i
         intoxLabel = intoxStages[i]?.label || intoxLabel
      } else break
   }

   let intoxTimeLabel = ""
   if (toxicity > 0 && intoxIdx >= 0) {
      const stageCfg = intoxStages[intoxIdx]
      const amt = Math.max(
         0,
         Number(stageCfg?.decay?.amount) ||
            Number(cat.acute?.decay?.amount) ||
            0,
      )
      const perSec = Math.max(
         60,
         toSeconds(stageCfg?.decay?.per || cat.acute?.decay?.per),
      )

      if (amt > 0) {
         const ticks = Math.ceil(toxicity / amt)
         const rawNext = s[STATE.DECAY_NEXT]
         const nextTick = Number(rawNext) || 0
         let remaining = 0
         if (isFutureTimestamp(rawNext, now)) {
            remaining = nextTick - now + (ticks - 1) * perSec
         } else {
            remaining = ticks * perSec
         }
         intoxTimeLabel = `[${_formatTime(remaining)}]`
      }
   }

   const overdoseTox = cat.acute?.overdose?.threshold ?? 0
   let maxBarTox = overdoseTox
   if (maxBarTox <= 0) {
      const maxStageTox = intoxStages.length
         ? Math.max(...intoxStages.map((stg) => stg.tox))
         : 0
      maxBarTox = Math.max(toxicity, maxStageTox, 1)
   }

   const toxPercent = Math.min(
      100,
      Math.max(0, Math.round((toxicity / maxBarTox) * 100)),
   )

   const intoxMarkers = []
   for (const stg of intoxStages) {
      if (stg.tox > 0 && stg.tox <= maxBarTox) {
         intoxMarkers.push({
            percent: Math.min(
               100,
               Math.max(0, Math.round((stg.tox / maxBarTox) * 100)),
            ),
            label: stg.label,
            threshold: stg.tox,
         })
      }
   }

   const pkCfg = addictionStageConfig(cat, peakStage)
   const quitPenaltyMag = Math.abs(Number(pkCfg?.quitPenalty) || 0)

   const hasHangoverEffect = actor.items.some(
      (i) =>
         i.flags?.[MODULE_ID]?.phase === PHASE.HANGOVER &&
         i.flags?.[MODULE_ID]?.category === categoryId,
   )
   const hasOverdoseEffect = actor.items.some(
      (i) =>
         i.flags?.[MODULE_ID]?.phase === PHASE.OVERDOSE &&
         i.flags?.[MODULE_ID]?.category === categoryId,
   )

   return {
      categoryId,
      categoryName: cat.name,
      categoryImg: cat.img,
      tolerance,
      maxTol,
      tolPips,
      toxicity,
      maxBarTox,
      overdoseTox,
      toxPercent,
      intoxMarkers,
      intoxLabel,
      intoxTimeLabel,
      addictionPoints: ap,
      addictionStage: stageNum,
      addictionStageLabel: stgCfg?.label ?? "",
      nextThreshold,
      apPercent,
      isMaxAddiction,
      showApBar,
      isSatiated,
      satiatedTimeLabel,
      withdrawalStage,
      decayLabel,
      isApPaused,
      apPausedTimeLabel,
      hangoverPending: !!s[STATE.HANGOVER_PENDING],
      hasHangoverEffect,
      hasOverdoseEffect,
      quitPenalty: stageNum === 0 && quitPenaltyMag > 0 ? quitPenaltyMag : null,
      hasImmunity,
      immunityLabel,
   }
}

function _activateListeners(html, actor) {
   const bind = (selector, action) => {
      html.querySelectorAll(selector).forEach((el) => {
         el.addEventListener("click", async (ev) => {
            ev.preventDefault()
            ev.stopPropagation()
            await action(ev)
         })
      })
   }

   bind("[data-ll-action='tol-plus']", async (ev) => {
      const id = ev.currentTarget.dataset.categoryId
      const s = getState(actor, id)
      await api.setTolerance(actor, id, (Number(s[STATE.TOLERANCE]) || 0) + 1)
   })
   bind("[data-ll-action='tol-minus']", async (ev) => {
      const id = ev.currentTarget.dataset.categoryId
      const s = getState(actor, id)
      await api.setTolerance(
         actor,
         id,
         Math.max(0, (Number(s[STATE.TOLERANCE]) || 0) - 1),
      )
   })
   bind("[data-ll-action='tox-plus']", async (ev) => {
      const id = ev.currentTarget.dataset.categoryId
      const cat = getCategory(id)
      const s = getState(actor, id)
      const currentTox = Number(s[STATE.TOXICITY]) || 0
      if (ev.shiftKey) {
         const intoxStages = cat.acute?.intoxStages ?? []
         let nextTox = currentTox + 1
         for (const stg of intoxStages) {
            if (stg.tox > currentTox) {
               nextTox = stg.tox
               break
            }
         }
         await api.setToxicity(actor, id, nextTox)
      } else await api.setToxicity(actor, id, currentTox + 1)
   })

   bind("[data-ll-action='tox-minus']", async (ev) => {
      const id = ev.currentTarget.dataset.categoryId
      const cat = getCategory(id)
      const s = getState(actor, id)
      const currentTox = Number(s[STATE.TOXICITY]) || 0
      if (ev.shiftKey) {
         const intoxStages = cat.acute?.intoxStages ?? []
         let prevTox = 0
         for (let i = intoxStages.length - 1; i >= 0; i--) {
            if (intoxStages[i].tox < currentTox) {
               prevTox = intoxStages[i].tox
               break
            }
         }
         await api.setToxicity(actor, id, prevTox)
      } else await api.setToxicity(actor, id, Math.max(0, currentTox - 1))
   })

   bind("[data-ll-action='ap-plus']", async (ev) => {
      const id = ev.currentTarget.dataset.categoryId
      const cat = getCategory(id)
      const s = getState(actor, id)
      const currentAP = Number(s[STATE.ADDICTION_POINTS]) || 0
      if (ev.shiftKey) {
         const currentStage = Number(s[STATE.ADDICTION_STAGE]) || 0
         const nextCfg = addictionStageConfig(cat, currentStage + 1)
         const nextThreshold = nextCfg?.apThreshold
         if (nextThreshold) await api.setAP(actor, id, nextThreshold)
      } else await api.setAP(actor, id, currentAP + 1)
   })

   bind("[data-ll-action='ap-minus']", async (ev) => {
      const id = ev.currentTarget.dataset.categoryId
      const cat = getCategory(id)
      const s = getState(actor, id)
      const currentAP = Number(s[STATE.ADDICTION_POINTS]) || 0
      if (ev.shiftKey) {
         const currentStage = Number(s[STATE.ADDICTION_STAGE]) || 0
         const prevThreshold =
            currentStage > 1
               ? addictionStageConfig(cat, currentStage - 1)?.apThreshold
               : 0
         await api.setAP(actor, id, prevThreshold)
      } else await api.setAP(actor, id, Math.max(0, currentAP - 1))
   })

   bind("[data-ll-action='satiate']", async (ev) => {
      await api.forceSatiate(actor, ev.currentTarget.dataset.categoryId)
   })
   bind("[data-ll-action='force-unsatiate']", async (ev) => {
      await api.forceUnsatiate(actor, ev.currentTarget.dataset.categoryId)
   })
   bind("[data-ll-action='manage-immunities']", async (ev) => {
      await api.manageImmunitiesDialog(
         actor,
         ev.currentTarget.dataset.categoryId,
      )
   })
   bind("[data-ll-action='cure-penalty']", async (ev) => {
      await api.curePenalty(actor, ev.currentTarget.dataset.categoryId)
   })
   bind("[data-ll-action='cure-hangover']", async (ev) => {
      await api.cureHangover(actor, ev.currentTarget.dataset.categoryId)
   })
   bind("[data-ll-action='cure-overdose']", async (ev) => {
      await api.cureOverdose(actor, ev.currentTarget.dataset.categoryId)
   })
   bind("[data-ll-action='cure']", async (ev) => {
      await api.cure(actor, ev.currentTarget.dataset.categoryId)
   })
   bind("[data-ll-action='remove-category']", async (ev) => {
      await api.cure(actor, ev.currentTarget.dataset.categoryId)
   })
}
