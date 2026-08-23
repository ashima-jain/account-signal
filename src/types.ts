export type Persona = 'Planners' | 'Operations' | 'Builders' | 'Other Folks';

export interface TargetPerson {
  name: string;
  title: string;
  persona: Persona;
  evidence: string;
  whyRelevant: string;
}

export interface Hypothesis {
  text: string;
  falsifiableTest: string;
  evidence: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface DiscoveryQuestion {
  question: string;
  whyItWorks: string;
}

export interface ConfidenceEvidence {
  type: 'fact' | 'assumption';
  statement: string;
  source?: string;
}

export interface ResearchOutput {
  knownFacts: string[];
  hypotheses: Hypothesis[];
  targets: TargetPerson[];
  priorities: Record<Persona, string[]>;
  email: {
    subject: string;
    body: string;
  };
  coldCallOpener: string;
  discoveryQuestions: DiscoveryQuestion[];
  confidenceEvidence: ConfidenceEvidence[];
}

export interface Account {
  id: string;
  companyName: string;
  targetName?: string;
  targetTitle?: string;
  researchNotes: string;
  people: Array<{ name: string; title: string }>;
  research?: ResearchOutput;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchRequest {
  companyName: string;
  targetName?: string;
  targetTitle?: string;
  researchNotes: string;
  people: Array<{ name: string; title: string }>;
}
