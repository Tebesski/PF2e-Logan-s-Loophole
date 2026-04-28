export function registerHandlebarsHelpers() {
   Handlebars.registerHelper("ll-add", (a, b) => Number(a) + Number(b))
   Handlebars.registerHelper("ll-eq", (a, b) => a === b)
   Handlebars.registerHelper("ll-gt", (a, b) => Number(a) > Number(b))
   Handlebars.registerHelper("ll-gte", (a, b) => Number(a) >= Number(b))
   Handlebars.registerHelper("ll-and", (...args) => {
      args.pop()
      return args.every(Boolean)
   })
   Handlebars.registerHelper("ll-or", (...args) => {
      args.pop()
      return args.some(Boolean)
   })
   Handlebars.registerHelper("ll-concat", (...args) => {
      args.pop()
      return args.join("")
   })
}
