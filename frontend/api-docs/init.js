// Initialisation de Swagger UI (fichier séparé : la CSP interdit les scripts en ligne).
window.ui = SwaggerUIBundle({
  url: '../api/openapi.json',
  dom_id: '#swagger-ui',
  deepLinking: true,
  validatorUrl: null, // pas d'appel au validateur en ligne de swagger.io
  tryItOutEnabled: true,
  defaultModelsExpandDepth: 0,
})
