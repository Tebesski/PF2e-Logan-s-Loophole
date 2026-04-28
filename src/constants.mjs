export const MODULE_ID = "pf2e-logans-loophole"

export const FLAG = {
   STATE: "state",
   DRUG: "drug",
}

export const STATE = {
   TOXICITY: "toxicity",
   TOLERANCE: "tolerance",
   ADDICTION_POINTS: "addictionPoints",
   ADDICTION_STAGE: "addictionStage",
   PEAK_STAGE: "peakStage",
   WITHDRAWAL_STAGE: "withdrawalStage",
   INTOX_STAGE: "intoxStage",
   SATIATION_END: "satiationEnd",
   SATIATION_KIND: "satiationKind",
   AP_DECAY_PAUSE_END: "apDecayPauseEnd",
   AP_DECAY_NEXT: "apDecayNext",
   DECAY_NEXT: "decayNext",
   HANGOVER_PENDING: "hangoverPending",
   CATEGORY_NAME: "categoryName",
   CATEGORY_IMG: "categoryImg",
}

export const SATIATION_KIND = {
   REAL: "real",
   FAKE: "fake",
}

export const TIME_UNIT = {
   rounds: 6,
   minutes: 60,
   hours: 3600,
   days: 86400,
}

export const DOS = {
   CRITICAL_SUCCESS: "criticalSuccess",
   SUCCESS: "success",
   FAILURE: "failure",
   CRITICAL_FAILURE: "criticalFailure",
}

export const DOS_ORDER = [
   DOS.CRITICAL_SUCCESS,
   DOS.SUCCESS,
   DOS.FAILURE,
   DOS.CRITICAL_FAILURE,
]

export const INTENT = {
   RESIST: "resist",
   EMBRACE: "embrace",
}

export const PHASE = {
   INTOXICATION: "intoxication",
   HANGOVER: "hangover",
   WITHDRAWAL: "withdrawal",
   PERMANENT: "permanent",
   OVERDOSE: "overdose",
   IMMUNITY: "immunity",
}

export const EFFECT_TYPE = {
   CONDITION: "condition",
   UUID: "uuid",
   RULE: "rule",
}

export const IMMUNITY_ASPECTS = [
   "addiction",
   "withdrawal",
   "hangover",
   "intoxication",
   "overdose",
]

export const EXPOSURE_TRAITS = [
   { slug: "ingested", label: "Ingested" },
   { slug: "inhaled", label: "Inhaled" },
   { slug: "contact", label: "Contact" },
   { slug: "injury", label: "Injury" },
]

export const EXPOSURE_SLUGS = EXPOSURE_TRAITS.map((t) => t.slug)

export const PF2E_DAMAGE_TYPES = [
   "acid",
   "bludgeoning",
   "cold",
   "electricity",
   "fire",
   "force",
   "mental",
   "negative",
   "piercing",
   "poison",
   "positive",
   "slashing",
   "sonic",
   "spirit",
   "vitality",
   "void",
]

export const VALUED_CONDITIONS = new Set([
   "clumsy",
   "doomed",
   "drained",
   "dying",
   "enfeebled",
   "frightened",
   "sickened",
   "slowed",
   "stunned",
   "stupefied",
   "wounded",
])

export const PF2E_CONDITIONS_ALL = [
   "blinded",
   "clumsy",
   "concealed",
   "confused",
   "controlled",
   "dazzled",
   "deafened",
   "doomed",
   "drained",
   "dying",
   "encumbered",
   "enfeebled",
   "fascinated",
   "fatigued",
   "flat-footed",
   "fleeing",
   "frightened",
   "grabbed",
   "hidden",
   "immobilized",
   "off-guard",
   "paralyzed",
   "persistent-damage",
   "petrified",
   "prone",
   "quickened",
   "restrained",
   "sickened",
   "slowed",
   "stunned",
   "stupefied",
   "unconscious",
   "undetected",
   "unnoticed",
   "wounded",
]

export const SFX_GLOBAL_KEYS = [
   "intoxication",
   "addiction",
   "satiation",
   "withdrawal",
   "cure",
]

export const DEFAULT_SFX_GLOBAL = Object.fromEntries(
   SFX_GLOBAL_KEYS.map((k) => [k, ""]),
)

export const ENVELOPE_VERSION = 1

export const DEFAULT_CONSUMABLE_ICON =
   "systems/pf2e/icons/default-icons/consumable.svg"

export function canEditRegistry() {
   const role = game.user?.role ?? 0
   const ASSISTANT = CONST?.USER_ROLES?.ASSISTANT ?? 3
   return role >= ASSISTANT
}

export function canUseHudControls() {
   const role = game.user?.role ?? 0
   const TRUSTED = CONST?.USER_ROLES?.TRUSTED ?? 2
   return role >= TRUSTED
}

export const DEFAULT_CATEGORY = () => ({
   id: foundry.utils.randomID(),
   name: "New Category",
   img: "icons/commodities/materials/bowl-liquid-red.webp",
   description: "",
   rollOptions: "",
   acute: {
      rollOptions: "",
      intoxStages: [
         {
            tox: 2,
            label: "Tipsy",
            description: "",
            decay: { amount: 1, per: { value: 1, unit: "hours" } },
            payload: { formula: "", damageType: "poison" },
            effects: [],
         },
      ],
      overdose: {
         threshold: 12,
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
            payload: { formula: "2d6", damageType: "poison" },
            effects: [{ type: "condition", slug: "unconscious", value: null }],
         },
         criticalFailure: {
            payload: { formula: "4d6", damageType: "poison" },
            effects: [{ type: "condition", slug: "dying", value: 1 }],
         },
      },
      hangover: {
         enabled: false,
         threshold: 5,
         dc: 15,
         rollOptions: "",
         description: "",
         duration: { value: 4, unit: "hours" },
         failure: {
            effects: [{ type: "condition", slug: "sickened", value: 1 }],
         },
         criticalFailure: {
            effects: [{ type: "condition", slug: "sickened", value: 2 }],
         },
      },
   },
   chronic: {
      baseWillDC: 15,
      rollOptions: "",
      addictionStages: [
         {
            apThreshold: 5,
            label: "Habitual",
            description: "",
            maxTolerance: 6,
            willPenalty: 4,
            quitPenalty: 4,
            apDecayAmount: 1,
            apDecayPer: { value: 2, unit: "days" },
            satiation: { value: 12, unit: "hours" },
            chronicEffects: [],
            withdrawalEffects: [],
         },
      ],
   },
})

export const DEFAULT_DRUG = () => ({
   categoryId: "",
   tv: 1,
   fortitudeDC: null,
   damagePerTv: { formula: "", damageType: "poison" },
   potent: false,
   addictive: true,
   apYieldFailure: 1,
   apYieldCriticalFailure: 2,
   apYieldSuccess: 1,
   apYieldCriticalSuccess: 0,
   sfx: {
      consume: "",
      intoxication: "",
      addiction: "",
      satiation: "",
      withdrawal: "",
      cure: "",
   },
})
