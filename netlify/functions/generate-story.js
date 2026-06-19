exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { q1, q2, q3, q4, q5, q6 } = JSON.parse(event.body);

    const prompt = `You are helping a renter write a personal statement for their profile on Renters.com, a rental marketplace where landlords can search for and connect with renters directly. The statement will be read by landlords who are considering renting to this person.

Write a warm, honest, first-person personal statement of 150-200 words based on their answers below. The tone should feel like a real person speaking — not a cover letter, not a form response. Be specific using their details. If they mentioned any challenges (credit, background, etc.), address them honestly and positively. End with something that makes a landlord want to reach out.

About them: ${q1}
What they're looking for: ${q2}
Rental history: ${q3}
Any context a landlord might need: ${q4 || "Nothing specific mentioned."}
What makes them a good tenant: ${q5}
Anything else: ${q6 || "Nothing additional."}

Write only the personal statement — no introduction, no title, no quotes around it. Just the statement itself in first person.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
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
      body: JSON.stringify({ story: text }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
