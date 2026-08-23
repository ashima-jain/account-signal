import type { Context } from '@netlify/functions';
import { OpenAI } from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import type { ResearchRequest, ResearchOutput } from '../../src/types';

const Persona = z.enum(['Planners', 'Operations', 'Builders', 'Other Folks']);

const ResearchSchema = z.object({
  knownFacts: z.array(z.string()).describe('Verified facts drawn only from the supplied research. No speculation.'),
  hypotheses: z.array(
    z.object({
      text: z.string().describe('A specific, falsifiable hypothesis about the account.'),
      falsifiableTest: z.string().describe('A question or observation that could prove or disprove this hypothesis on a call.'),
      evidence: z.string().describe('The input evidence that supports this hypothesis, if any.'),
      confidence: z.enum(['high', 'medium', 'low']).describe('Confidence based on the strength of the evidence.'),
    })
  ).length(3).describe('Exactly three falsifiable account hypotheses.'),
  targets: z.array(
    z.object({
      name: z.string(),
      title: z.string(),
      persona: Persona.describe('Classify into one of the four personas: Planners, Operations, Builders, or Other Folks.'),
      evidence: z.string().describe('Why this persona label fits based on the title.'),
      whyRelevant: z.string().describe('Why this person is a good target for Factory.'),
    })
  ).length(10).describe('Exactly ten potential targets at the account. Include the provided people and infer plausible additional roles to reach ten.'),
  priorities: z.object({
    Planners: z.array(z.string()).describe('Likely priorities for Line of Business Owners, Product Managers, and Architects.'),
    Operations: z.array(z.string()).describe('Likely priorities for IT Infrastructure, SREs, DevOps, Platform Engineers, and Engineering Management.'),
    Builders: z.array(z.string()).describe('Likely priorities for Backend, Front End, Mobile Engineers, and Engineering Management.'),
    'Other Folks': z.array(z.string()).describe('Likely priorities for Sales, Security, Legal, Procurement, Data Scientists, and Business Analysts.'),
  }).describe('Likely priorities for each target persona.'),
  email: z.object({
    subject: z.string().describe('Short, personalized outbound email subject line.'),
    body: z.string().describe('Personalized outbound email body, under 150 words.'),
  }).describe('A short personalized outbound email.'),
  coldCallOpener: z.string().describe('A 30-second cold-call opener script.'),
  discoveryQuestions: z.array(
    z.object({
      question: z.string().describe('A concise discovery question.'),
      whyItWorks: z.string().describe('Why this question is likely to surface useful information.'),
    })
  ).length(3).describe('Exactly three discovery questions.'),
  confidenceEvidence: z.array(
    z.object({
      type: z.enum(['fact', 'assumption']).describe('Is this statement supported by the input or is it an assumption?'),
      statement: z.string().describe('The fact or assumption stated clearly.'),
      source: z.string().nullable().describe('The input that supports it, if it is a fact.'),
    })
  ).describe('A clear separation of facts and assumptions.'),
});

export default async (req: Request, _context: Context) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const apiKey = Netlify.env.get('OPENAI_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'OpenAI API key is not configured' }), { status: 500 });
  }

  let body: ResearchRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  if (!body.companyName || body.companyName.trim() === '') {
    return new Response(JSON.stringify({ error: 'Company name is required' }), { status: 400 });
  }

  const openai = new OpenAI({ apiKey });

  const systemPrompt = `You are an expert enterprise sales research assistant for Factory, an AI engineering company. You help account executives prepare for outbound by turning account research into actionable insights.

The four target personas are:
1. Planners — responsible for creating requirements and roadmap. Includes Line of Business Owners, Product Managers, Architects.
2. Operations — responsible for ensuring availability and reliability of platforms. Includes IT Infrastructure, Site Reliability Engineers, DevOps, Platform Engineers, Engineering Management (Managers, Directors, VP).
3. Builders — responsible for delivering the vision of planners. Includes Backend Engineers, Front End Engineers, Mobile Engineers, Engineering Management (Managers, Directors, VP).
4. Other Folks — not directly connected to the creation or operation of apps. Includes Sales, Security, Legal, Procurement, Data Scientists, Business Analysts.

Rules:
- Only state facts when they are directly supported by the supplied research.
- Label everything else as an assumption.
- Hypotheses must be falsifiable: include a concrete test or question that could prove or disprove them on a discovery call.
- Generate exactly ten potential targets. Use the provided people first, then infer plausible additional roles at the company to reach ten.
- Classify each target into exactly one persona.
- The outbound email should be personalized, concise, and relevant to the account's likely priorities.
- The cold-call opener should be a 30-second script the AE can read naturally.
- Discovery questions should be open-ended and designed to surface pain or budget authority.

Respond in the requested JSON format.`;

  const userPrompt = `Company: ${body.companyName}
Target name (optional): ${body.targetName || 'Not provided'}
Target title (optional): ${body.targetTitle || 'Not provided'}

People provided:
${body.people.map(p => `- ${p.name || 'Unknown'} (${p.title || 'Unknown'})`).join('\n') || 'None provided'}

Research notes:
${body.researchNotes || 'None provided'}`;

  try {
    const completion = await openai.chat.completions.parse({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: zodResponseFormat(ResearchSchema, 'research_output'),
      temperature: 0.7,
    });

    const parsed = completion.choices[0]?.message?.parsed;
    if (!parsed) {
      return new Response(JSON.stringify({ error: 'No structured response from OpenAI' }), { status: 500 });
    }

    const output: ResearchOutput = {
      knownFacts: parsed.knownFacts,
      hypotheses: parsed.hypotheses,
      targets: parsed.targets,
      priorities: parsed.priorities,
      email: parsed.email,
      coldCallOpener: parsed.coldCallOpener,
      discoveryQuestions: parsed.discoveryQuestions,
      confidenceEvidence: parsed.confidenceEvidence,
    };

    return new Response(JSON.stringify(output), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
};
