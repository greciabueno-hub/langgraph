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
    customerId: "dc2cedec-04fd-462d-a228-48e4cecb3a17", 
    conversationId: "conv_dc2cedec-04fd-462d-a228-48e4cecb3a17_1763572113455", 
  }
  // {
  //   id: "urgent-buyer",
  //   name: "Urgent Buyer",
  //   description: "Needs a car this week for a new job starting Monday. Expresses urgency and time pressure. Wants to move quickly through the process. May be willing to pay slightly more for immediate availability. Shows stress and needs reassurance.",
  //   customerId: "bd5f3981-b916-478a-89a0-b74de4daee7a", 
  //   conversationId: "conv_bd5f3981-b916-478a-89a0-b74de4daee7a_1763497223570", 
  // },
  // {
  //   id: "first-time-buyer",
  //   name: "First-Time Buyer",
  //   description: "First-time car buyer, uncertain about needs and preferences. Asks many questions, needs guidance and education. Doesn't know much about cars, financing, or the buying process. May be overwhelmed and needs patience. Looking for a reliable, safe vehicle for daily commuting.",
  //   customerId: "21d2814f-2907-46e3-9834-760ded1eda6b", 
  //   conversationId: "conv_21d2814f-2907-46e3-9834-760ded1eda6b_1763497226472", 
  // },
];

export function getPersonaById(id: string): Persona | undefined {
  return personas.find((p) => p.id === id);
}

export function getPersonaDescription(id: string): string {
  const persona = getPersonaById(id);
  return persona ? persona.description : "";
}

