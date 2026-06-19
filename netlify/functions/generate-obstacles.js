exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { checked, q1, q2, q3, q4 } = JSON.parse(event.body);

    const checklistText = (checked && checked.length)
      ? checked.join(", ")
      : "None specifically checked";

    const prompt = `You are helping a renter privately explain the practical obstacles in their housing search to the Renters.com team. This text is NEVER shown publicly — it is only seen internally, to help Renters.com actually advocate for and assist the renter.

These obstacles are usually practical or circumstantial, not about credit or eviction history — things like: affordability mismatch, credit or financial differences within a household, irregular or hard-to-document income, having been scammed before, caregiving responsibilities, divorce or major life transitions, or needing a specific rental type that's hard to find.

Write a clear, first-person summary of 100-150 words based on their answers below. The tone should be plain and direct, like someone explaining their situation to a person who's going to help them. End with what kind of help would actually make a difference for them.

Categories they identified: ${checklistText}
Additional detail on those: ${q1 || "Nothing additional."}
What would actually help: ${q2}
Anything else: ${q3 || "Nothing additional."}

Write only the summary — no introduction, no title, no quotes around it. First person, conversational.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 800,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: data.error || "Anthropic API error" }),
      };
    }

    const text = data.content && data.content[0] ? data.content[0].text : "";

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summary: text }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
