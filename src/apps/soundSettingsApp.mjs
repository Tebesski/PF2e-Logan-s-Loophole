import { MODULE_ID } from "../constants.mjs"
import { Settings } from "../settings.mjs"
import { resolveWildcard } from "../utils/sfx.mjs"

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

const SFX_ROW_KEYS = [
   { key: "intoxication", label: "Intoxication" },
   { key: "addiction", label: "Addiction" },
   { key: "satiation", label: "Satiation" },
   { key: "withdrawal", label: "Withdrawal" },
   { key: "cure", label: "Cure" },
]

const SFX_ROW_TIPS = {
   intoxication: "Played when the actor enters a new intoxication stage.",
   addiction: "Played when the actor's addiction stage increases.",
   satiation:
      "Played when a dose refreshes satiation (the addiction is temporarily quiet).",
   withdrawal:
      "Played when an actor's satiation expires and they enter withdrawal.",
   cure: "Played when an actor recovers from a stage of addiction.",
}

export class SoundSettingsApp extends HandlebarsApplicationMixin(
   ApplicationV2,
) {
   static DEFAULT_OPTIONS = {
      id: "ll-sound-settings",
      classes: ["logans-loophole", "ll-sound-settings"],
      tag: "form",
      window: {
         title: "LL.SoundApp.Title",
         icon: "fas fa-volume-high",
         resizable: true,
      },
      position: { width: 620, height: "auto" },
      form: {
         submitOnChange: false,
         closeOnSubmit: false,
      },
      actions: {
         "pick-sfx": SoundSettingsApp._onPickSfx,
         "clear-sfx": SoundSettingsApp._onClearSfx,
         "preview-sfx": SoundSettingsApp._onPreviewSfx,
         save: SoundSettingsApp._onSave,
      },
   }

   static PARTS = {
      main: {
         template: `modules/${MODULE_ID}/templates/sound-settings-app.hbs`,
      },
   }

   _draft = null

   async _prepareContext() {
      if (!this._draft)
         this._draft = foundry.utils.deepClone(Settings.defaultSfx)
      return {
         draft: this._draft,
         keys: SFX_ROW_KEYS.map(({ key, label }) => ({
            key,
            label,
            tip: SFX_ROW_TIPS[key],
         })),
      }
   }

   static async _onPickSfx(_event, target) {
      const key = target.dataset.sfxKey
      const current = this._draft[key] || ""
      const FP =
         foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker
      new FP({
         type: "audio",
         current,
         callback: (chosen) => {
            this._draft[key] = chosen
            this.render(true)
         },
      }).render(true)
   }

   static async _onClearSfx(_event, target) {
      const key = target.dataset.sfxKey
      this._draft[key] = ""
      this.render(true)
   }

   static async _onPreviewSfx(_event, target) {
      const key = target.dataset.sfxKey
      const src = this._draft[key]
      if (!src) {
         ui.notifications?.warn(game.i18n.localize("LL.SoundApp.NoSoundSet"))
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
            game.i18n.format("LL.SoundApp.PreviewFailed", {
               message: err.message,
            }),
         )
      }
   }

   static async _onSave(_event, _target) {
      await Settings.setDefaultSfx(this._draft)
      ui.notifications?.info(game.i18n.localize("LL.SoundApp.Saved"))
      this.close()
   }
}
