exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { q1, q2, q3, q4 } = JSON.parse(event.body);

    const prompt = `You are helping a renter privately explain the practical obstacles in their housing search to the Renters.com team. This text is NEVER shown publicly or to landlords — it is only seen internally, to help Renters.com actually advocate for and assist the renter (not just hand them a search tool).

These obstacles are usually practical or circumstantial, not about credit or eviction history — things like: lack of time to search, discomfort with technology, having been scammed before, caregiving responsibilities, divorce or major life transitions, needing a specific rental type (e.g. mid-term) that's hard to find, or needing to be near a specific location like work.

Write a clear, first-person summary of 100-150 words based on their answers below. The tone should be plain and direct, like someone explaining their situation to a person who's going to help them, not filling out a form. End with what kind of help would actually make a difference for them.

What's getting in the way: ${q1}
Search history so far: ${q2}
What would actually help: ${q3}
Anything else: ${q4 || "Nothing additional."}

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
