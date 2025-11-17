// src/personas.ts
// Customer personas for testing BDC performance

export interface Persona {
  id: string;
  name: string;
  description: string;
  customerId?: string; // Pre-existing customer ID from your backend
  conversationId?: string; // Pre-existing conversation ID from your backend
}

export const personas: Persona[] = [
  {
    id: "budget-conscious",
    name: "Budget-Conscious Buyer",
    description: "Very price-sensitive, needs to stay within strict budget constraints. Asks about financing options and wants to see the best value. May be hesitant about additional features that add cost.",
    customerId: "171a501a-ba90-4864-8251-99f35915a17f", // Replace with your actual customer ID
    conversationId: "conv_171a501a-ba90-4864-8251-99f35915a17f_1763412237583", // Replace with your actual conversation ID
  },
  {
    id: "urgent-buyer",
    name: "Urgent Buyer",
    description: "Needs a car this week for a new job starting Monday. Expresses urgency and time pressure. Wants to move quickly through the process. May be willing to pay slightly more for immediate availability. Shows stress and needs reassurance.",
    customerId: "06de27fa-4d2e-4474-9645-f318712d2bbf", // Replace with your actual customer ID
    conversationId: "conv_06de27fa-4d2e-4474-9645-f318712d2bbf_1763412239251", // Replace with your actual conversation ID
  },
  {
    id: "first-time-buyer",
    name: "First-Time Buyer",
    description: "First-time car buyer, uncertain about needs and preferences. Asks many questions, needs guidance and education. Doesn't know much about cars, financing, or the buying process. May be overwhelmed and needs patience. Looking for a reliable, safe vehicle for daily commuting.",
    customerId: "d94f2cfb-8757-4a08-b34b-6c0c41367eae", // Replace with your actual customer ID
    conversationId: "conv_d94f2cfb-8757-4a08-b34b-6c0c41367eae_1763412241078", // Replace with your actual conversation ID
  },
];

export function getPersonaById(id: string): Persona | undefined {
  return personas.find((p) => p.id === id);
}

export function getPersonaDescription(id: string): string {
  const persona = getPersonaById(id);
  return persona ? persona.description : "";
}

