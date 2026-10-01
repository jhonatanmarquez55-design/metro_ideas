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
      products = []
    } = req.body || {};

    if (!centralIdea || typeof centralIdea !== "string") {
      return res.status(400).json({ error: "Falta la idea central." });
    }

    const safeClient = String(client).slice(0, 120);
    const safeCampaign = String(campaign).slice(0, 160);
    const safeIdea = String(centralIdea).slice(0, 1800);
    const safeProducts = Array.isArray(products)
      ? products.slice(0, 30).map(x => String(x).slice(0, 120))
      : [];

    const prompt = `
Eres un estratega comercial y de contenidos de Metro Ecuador.

Genera DOS caminos de propuesta digital para una ejecutiva comercial.

CLIENTE:
${safeClient || "No indicado"}

CAMPAÑA:
${safeCampaign || "No indicada"}

IDEA INICIAL:
${safeIdea}

PRODUCTOS SELECCIONADOS:
${safeProducts.length ? safeProducts.join(", ") : "No indicados"}

REGLAS:
- Genera exactamente 2 ideas.
- Cada una debe ser un solo párrafo breve.
- Aproximadamente 70 a 110 palabras por idea.
- Deben tener enfoques claramente distintos.
- Deben ser concretas, comerciales y fáciles de entender.
- Usa los productos seleccionados cuando aporten sentido.
- No inventes productos adicionales.
- No inventes precios, métricas, resultados ni alcance.
- No prometas resultados.
- No desarrolles aún el plan completo.

Devuelve SOLO JSON válido con esta estructura:
{
  "ideas": [
    "Primer párrafo...",
    "Segundo párrafo..."
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
        model: "gpt-6-astra",
        input: prompt
      })
    });

    if (!apiResponse.ok) {
      const detail = await apiResponse.text();
      console.error("OpenAI error:", apiResponse.status, detail);
      return res.status(502).json({ error: "OpenAI no pudo generar las ideas." });
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

    return res.status(200).json({
      ideas: [String(parsed.ideas[0]), String(parsed.ideas[1])]
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      error: "No se pudieron generar las ideas.",
      detail: error?.message || "Error desconocido"
    });
  }
}

