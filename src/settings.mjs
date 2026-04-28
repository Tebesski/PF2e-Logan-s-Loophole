import { MODULE_ID, IMMUNITY_ASPECTS, DEFAULT_SFX_GLOBAL } from "./constants.mjs"
import { CategoryRegistryApp } from "./apps/categoryRegistryApp.mjs"
import { SoundSettingsApp } from "./apps/soundSettingsApp.mjs"

export function registerSettings() {
   game.settings.register(MODULE_ID, "registry", {
      scope: "world",
      config: false,
      type: Object,
      default: { categories: {} },
   })

   game.settings.register(MODULE_ID, "hasSeededDefaults", {
      scope: "world",
      config: false,
      type: Boolean,
      default: false,
   })

   game.settings.registerMenu(MODULE_ID, "registryMenu", {
      name: "LL.Settings.RegistryMenu",
      label: "LL.Settings.RegistryMenuLabel",
      hint: "LL.Settings.RegistryMenuHint",
      icon: "fas fa-flask",
      type: CategoryRegistryApp,
      restricted: true,
   })

   game.settings.register(MODULE_ID, "promptEmbrace", {
      name: "LL.Settings.PromptEmbrace",
      hint: "LL.Settings.PromptEmbraceHint",
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
   })

   game.settings.register(MODULE_ID, "ghostPenalty", {
      name: "LL.Settings.GhostPenalty",
      hint: "LL.Settings.GhostPenaltyHint",
      scope: "world",
      config: true,
      type: Number,
      default: -2,
   })

   game.settings.register(MODULE_ID, "treatmentKitRequirement", {
      name: "LL.Settings.TreatmentKitRequirement",
      hint: "LL.Settings.TreatmentKitRequirementHint",
      scope: "world",
      config: true,
      type: String,
      choices: {
         none: "LL.Settings.KitNone",
         infinite: "LL.Settings.KitInfinite",
         consumable: "LL.Settings.KitConsumable",
      },
      default: "none",
   })

   game.settings.register(MODULE_ID, "longRestRestoresTolerance", {
      name: "LL.Settings.LongRestRestoresTolerance",
      hint: "LL.Settings.LongRestRestoresToleranceHint",
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
   })

   game.settings.register(MODULE_ID, "longRestClearsToxicity", {
      name: "LL.Settings.LongRestClearsToxicity",
      hint: "LL.Settings.LongRestClearsToxicityHint",
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
   })

   game.settings.register(MODULE_ID, "showSceneControlButton", {
      name: "LL.Settings.ShowSceneControlButton",
      hint: "LL.Settings.ShowSceneControlButtonHint",
      scope: "client",
      config: true,
      type: Boolean,
      default: true,
   })

   game.settings.register(MODULE_ID, "useConTolerance", {
      name: "LL.Settings.UseConTolerance",
      hint: "LL.Settings.UseConToleranceHint",
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
   })

   game.settings.register(MODULE_ID, "conToleranceAddictedOnly", {
      name: "LL.Settings.ConToleranceAddictedOnly",
      hint: "LL.Settings.ConToleranceAddictedOnlyHint",
      scope: "world",
      config: true,
      type: Boolean,
      default: false,
   })

   game.settings.register(MODULE_ID, "treatmentImmunityHours", {
      name: "LL.Settings.TreatmentImmunityHours",
      hint: "LL.Settings.TreatmentImmunityHoursHint",
      scope: "world",
      config: true,
      type: Number,
      default: 24,
   })

   game.settings.register(MODULE_ID, "separateAddictionImmunities", {
      name: "LL.Settings.SeparateAddictionImmunities",
      hint: "LL.Settings.SeparateAddictionImmunitiesHint",
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
   })

   IMMUNITY_ASPECTS.forEach((asp) => {
      const aspectCap = asp.charAt(0).toUpperCase() + asp.slice(1)

      game.settings.register(MODULE_ID, `immunityToggle_${asp}`, {
         name: `Separate Immunity: ${aspectCap}`,
         hint: `If enabled, successful ${aspectCap} treatments will use the specific immunity duration below instead of the base immunity.`,
         scope: "world",
         config: true,
         type: Boolean,
         default: false,
      })
      game.settings.register(MODULE_ID, `immunityHours_${asp}`, {
         name: `${aspectCap} Immunity`,
         hint: `The duration of immunity in hours applied after a successful ${aspectCap} treatment (if separate immunity is enabled).`,
         scope: "world",
         config: true,
         type: Number,
         default: 24,
      })
   })

   game.settings.register(MODULE_ID, "defaultSfx", {
      scope: "world",
      config: false,
      type: Object,
      default: { ...DEFAULT_SFX_GLOBAL },
   })

   game.settings.registerMenu(MODULE_ID, "soundSettingsMenu", {
      name: "LL.Settings.SoundSettingsMenuName",
      label: "LL.Settings.SoundSettingsMenuLabel",
      hint: "LL.Settings.SoundSettingsMenuHint",
      icon: "fas fa-volume-high",
      type: SoundSettingsApp,
      restricted: true,
   })
}

export const Settings = {
   get registry() {
      return game.settings.get(MODULE_ID, "registry") ?? { categories: {} }
   },
   async setRegistry(value) {
      await game.settings.set(MODULE_ID, "registry", value)
   },
   get promptEmbrace() {
      return game.settings.get(MODULE_ID, "promptEmbrace")
   },
   get ghostPenalty() {
      return game.settings.get(MODULE_ID, "ghostPenalty")
   },
   get longRestRestoresTolerance() {
      return game.settings.get(MODULE_ID, "longRestRestoresTolerance")
   },
   get longRestClearsToxicity() {
      return game.settings.get(MODULE_ID, "longRestClearsToxicity")
   },
   get showSceneControlButton() {
      return game.settings.get(MODULE_ID, "showSceneControlButton")
   },
   get defaultSfx() {
      return (
         game.settings.get(MODULE_ID, "defaultSfx") ?? { ...DEFAULT_SFX_GLOBAL }
      )
   },
   async setDefaultSfx(value) {
      await game.settings.set(MODULE_ID, "defaultSfx", value)
   },
}
