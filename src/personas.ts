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
    customerId: "e019c6d1-935f-4bf0-939a-a636e63cbeeb", 
    conversationId: "conv_e019c6d1-935f-4bf0-939a-a636e63cbeeb_1763572832603",
  },
  {
    id: "urgent-buyer",
    name: "Urgent Buyer",
    description: "Needs a car this week for a new job starting Monday. Expresses urgency and time pressure. Wants to move quickly through the process. May be willing to pay slightly more for immediate availability. Shows stress and needs reassurance.",
    customerId: "1755fbe1-ea60-483c-8061-b01a311327a2", 
    conversationId: "conv_1755fbe1-ea60-483c-8061-b01a311327a2_1763572835736",
  },
  {
    id: "first-time-buyer",
    name: "First-Time Buyer",
    description: "First-time car buyer, uncertain about needs and preferences. Asks many questions, needs guidance and education. Doesn't know much about cars, financing, or the buying process. May be overwhelmed and needs patience. Looking for a reliable, safe vehicle for daily commuting.",
    customerId: "067d9710-9482-49a3-b97c-fc9ed9b2daee", 
    conversationId: "conv_067d9710-9482-49a3-b97c-fc9ed9b2daee_1763572838409",
  },
  {
    id: "luxury-buyer",
    name: "Luxury Buyer",
    description: "Interested in premium vehicles with high-end features. Price is less of a concern, focuses on quality, brand reputation, and advanced technology. Wants the best of everything - leather seats, premium sound systems, advanced safety features. Values status and comfort over cost.",
    customerId: "af93a647-8353-4872-af1b-d69be0303997", 
    conversationId: "conv_af93a647-8353-4872-af1b-d69be0303997_1763572840962",
  },
  {
    id: "family-buyer",
    name: "Family Buyer",
    description: "Needs a vehicle that accommodates children and family needs. Prioritizes safety features, space, reliability, and practicality. Asks about car seats, cargo space, fuel efficiency for long trips. May need to fit multiple car seats or strollers. Values durability and family-friendly features.",
    customerId: "02c9d84b-12e7-4f93-a7d6-82c9f42b938b", 
    conversationId: "conv_02c9d84b-12e7-4f93-a7d6-82c9f42b938b_1763572843621",
  },
  {
    id: "tech-enthusiast",
    name: "Tech Enthusiast",
    description: "Interested in electric vehicles, hybrids, or vehicles with the latest technology. Asks about battery range, charging infrastructure, autonomous driving features, infotainment systems, and connectivity. Environmentally conscious, tech-savvy, wants cutting-edge features. May ask technical questions about specifications.",
    customerId: "8777e3e1-f00f-4c27-9e21-da52879c9817", 
    conversationId: "conv_8777e3e1-f00f-4c27-9e21-da52879c9817_1763572846378",
  },
];

export function getPersonaById(id: string): Persona | undefined {
  return personas.find((p) => p.id === id);
}

export function getPersonaDescription(id: string): string {
  const persona = getPersonaById(id);
  return persona ? persona.description : "";
}

