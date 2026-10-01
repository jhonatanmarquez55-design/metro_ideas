export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Solo se permite POST." });
  }

  try {
    const {
      client = "",
      campaign = "",
      centralIdea = "",
      selectedProducts = [],
      availableProducts = []
    } = req.body || {};

    if (!centralIdea || typeof centralIdea !== "string") {
      return res.status(400).json({ error: "Falta la idea central." });
    }

    const safeClient = String(client).slice(0, 120);
    const safeCampaign = String(campaign).slice(0, 160);
    const safeIdea = String(centralIdea).slice(0, 1800);

    const safeSelected = Array.isArray(selectedProducts)
      ? selectedProducts.slice(0, 30).map(x => String(x).slice(0, 140))
      : [];

    const safeAvailable = Array.isArray(availableProducts)
      ? availableProducts.slice(0, 60).map(x => String(x).slice(0, 140))
      : [];

    const prompt = `
Eres un estratega comercial y de contenidos de Metro Ecuador.

Debes generar DOS caminos de propuesta digital para una ejecutiva comercial.
Además de la idea, cada camino debe incluir una MINI PROPUESTA DE PRODUCTOS
con cantidades sugeridas.

CLIENTE:
${safeClient || "No indicado"}

CAMPAÑA:
${safeCampaign || "No indicada"}

IDEA INICIAL:
${safeIdea}

PRODUCTOS QUE LA EJECUTIVA YA HABÍA SELECCIONADO, SI EXISTEN:
${safeSelected.length ? safeSelected.join(", ") : "Ninguno todavía"}

PRODUCTOS DISPONIBLES EN EL TARIFARIO:
${safeAvailable.length ? safeAvailable.join("\n- ") : "No disponibles"}

REGLAS:
- Genera exactamente 2 caminos.
- Cada idea debe ser un solo párrafo de aproximadamente 70 a 110 palabras.
- Los dos caminos deben ser claramente distintos.
- Después de cada idea incluye una combinación pequeña y lógica de productos.
- Normalmente recomienda entre 2 y 4 tipos de producto por camino.
- Las cantidades pueden ser 1, 2, 3, etc., según tenga sentido.
- Usa EXCLUSIVAMENTE nombres presentes en PRODUCTOS DISPONIBLES EN EL TARIFARIO.
- Puedes mantener productos ya seleccionados si encajan, pero no estás obligado.
- No inventes precios.
- No inventes métricas, alcance, impresiones ni resultados.
- No prometas resultados.
- No incluyas banners/display a menos que aparezcan en la lista de productos disponibles.
- La combinación de productos debe tener relación directa con la idea.

Devuelve SOLO JSON válido con esta estructura exacta:
{
  "ideas": [
    {
      "text": "Primer párrafo...",
      "products": [
        {"product": "Nombre exacto del producto", "quantity": 1},
        {"product": "Nombre exacto del producto", "quantity": 2}
      ]
    },
    {
      "text": "Segundo párrafo...",
      "products": [
        {"product": "Nombre exacto del producto", "quantity": 1}
      ]
    }
  ]
}
`;

    const apiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-5.6-luna",
        input: prompt
      })
    });

    if (!apiResponse.ok) {
      const detail = await apiResponse.text();
      console.error("OpenAI error:", apiResponse.status, detail);
      return res.status(502).json({
        error: "OpenAI no pudo generar las ideas."
      });
    }

    const data = await apiResponse.json();

    let outputText = "";
    if (typeof data.output_text === "string") {
      outputText = data.output_text;
    } else if (Array.isArray(data.output)) {
      for (const item of data.output) {
        if (!Array.isArray(item.content)) continue;
        for (const part of item.content) {
          if (part.type === "output_text" && typeof part.text === "string") {
            outputText += part.text;
          }
        }
      }
    }

    const clean = outputText
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const parsed = JSON.parse(clean);

    if (!Array.isArray(parsed.ideas) || parsed.ideas.length < 2) {
      throw new Error("La respuesta no contiene dos ideas.");
    }

    const normalized = parsed.ideas.slice(0,2).map(item => ({
      text: String(item.text || item.idea || ""),
      products: Array.isArray(item.products)
        ? item.products.slice(0,6).map(p => ({
            product: String(p.product || p.name || ""),
            quantity: Math.max(1, Math.min(20, Number(p.quantity) || 1))
          })).filter(p => p.product)
        : []
    }));

    return res.status(200).json({ ideas: normalized });

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      error: "No se pudieron generar las ideas.",
      detail: error?.message || "Error desconocido"
    });
  }
}
