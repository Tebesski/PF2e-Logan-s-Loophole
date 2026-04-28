import { MODULE_ID, INTENT } from "../constants.mjs"

const { DialogV2 } = foundry.applications.api

export async function promptIntent({ itemName, categoryName }) {
   const content = await renderTemplate(
      `modules/${MODULE_ID}/templates/intent-prompt.hbs`,
      { itemName, categoryName },
   )
   try {
      const choice = await DialogV2.wait({
         window: { title: game.i18n.localize("LL.Intent.Title") },
         content,
         buttons: [
            {
               action: INTENT.RESIST,
               label: game.i18n.localize("LL.Intent.Resist"),
               icon: "fas fa-shield-halved",
               default: true,
            },
            {
               action: INTENT.EMBRACE,
               label: game.i18n.localize("LL.Intent.Embrace"),
               icon: "fas fa-fire",
            },
            {
               action: "ABORT",
               label: game.i18n.localize("LL.Intent.Cancel"),
               icon: "fas fa-times",
            },
         ],
         submit: (action) => action,
         rejectClose: false,
      })
      return choice === "ABORT" ? null : (choice ?? null)
   } catch (e) {
      return null
   }
}
