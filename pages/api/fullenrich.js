// Fullenrich v2 API — bulk async pattern
// POST all profiles → get enrichment_id → poll until FINISHED → return enriched contacts

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { profiles } = req.body; // [{ linkedinUrl, rawName, snippet }]
  if (!profiles?.length) return res.status(400).json({ error: "No profiles provided" });

  try {
    // ── Step 1: Start bulk enrichment ────────────────────────────────────
    const startRes = await fetch("https://app.fullenrich.com/api/v1/contact/enrich/bulk", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.FULLENRICH_API_KEY}`,
      },
      body: JSON.stringify({
        name: `V11 dinner agent - ${new Date().toISOString()}`,
        datas: profiles.map((p) => ({
          linkedin_url: p.linkedinUrl,
          enrich_fields: ["contact.emails"],
        })),
      }),
    });

    if (!startRes.ok) {
      const errText = await startRes.text();
      return res.status(startRes.status).json({ error: `Fullenrich start failed: ${errText}` });
    }

    const { enrichment_id } = await startRes.json();
    if (!enrichment_id) return res.status(500).json({ error: "No enrichment_id returned" });

    // ── Step 2: Poll until FINISHED ───────────────────────────────────────
    let result = null;
    const maxPolls = 40; // 40 x 3s = 2 minutes max
    for (let i = 0; i < maxPolls; i++) {
      await new Promise((r) => setTimeout(r, 3000));

      const pollRes = await fetch(
        `https://app.fullenrich.com/api/v1/contact/enrich/bulk/${enrichment_id}`,
        { headers: { Authorization: `Bearer ${process.env.FULLENRICH_API_KEY}` } }
      );

      if (!pollRes.ok) continue;
      result = await pollRes.json();

      if (result.status === "FINISHED") break;
      if (result.status === "CANCELED" || result.status === "CREDITS_INSUFFICIENT") {
        return res.status(400).json({ error: `Fullenrich ended with status: ${result.status}` });
      }
      // CREATED / IN_PROGRESS → keep polling
    }

    if (!result || result.status !== "FINISHED") {
      // Return partial results if we timed out
      if (result?.datas?.length) {
        result.status = "FINISHED"; // treat as finished
      } else {
        return res.status(408).json({ error: "Fullenrich enrichment timed out" });
      }
    }

    // ── Step 3: Map results back to input profiles ────────────────────────
    const enriched = profiles
      .map((profile, i) => {
        const row = result.datas?.[i];
        const contact = row?.contact;
        if (!contact) return null;

        const email =
          contact.most_probable_email ||
          contact.emails?.find((e) => e.status === "DELIVERABLE")?.email ||
          contact.emails?.[0]?.email;

        const prof = contact.profile;
        return {
          linkedinUrl: profile.linkedinUrl,
          rawName: profile.rawName,
          snippet: profile.snippet,
          firstName: prof?.firstname || contact.firstname || "",
          lastName: prof?.lastname || contact.lastname || "",
          email: email || null,
          title: prof?.headline || prof?.position?.title || "",
          company: prof?.position?.company?.name || contact.domain || "",
          location: prof?.location || "",
        };
      })
      .filter((p) => p && p.email);

    res.json({ enriched, total: profiles.length, found: enriched.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
