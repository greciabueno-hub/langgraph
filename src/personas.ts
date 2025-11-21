// src/personas.ts
// Customer personas for testing BDC performance

export interface Persona {
  id: string;
  description: string;
  name?: string; // Generated customer name (firstName + lastName) for database tracking
}

export const personas: Persona[] = [
  {
    id: "budget-conscious",
    description: "Very price-sensitive, needs to stay within strict budget constraints. Asks about financing options and wants to see the best value. May be hesitant about additional features that add cost.",
  },
  {
    id: "urgent-buyer",
    description: "Needs a car this week for a new job starting Monday. Expresses urgency and time pressure. Wants to move quickly through the process. May be willing to pay slightly more for immediate availability. Shows stress and needs reassurance."
  },
  {
    id: "first-time-buyer",
    description: "First-time car buyer, uncertain about needs and preferences. Asks many questions, needs guidance and education. Doesn't know much about cars, financing, or the buying process. May be overwhelmed and needs patience. Looking for a reliable, safe vehicle for daily commuting.",
  },
  // {
  //   id: "luxury-buyer",
  //   name: "David Thompson",
  //   description: "Interested in premium vehicles with high-end features. Price is less of a concern, focuses on quality, brand reputation, and advanced technology. Wants the best of everything - leather seats, premium sound systems, advanced safety features. Values status and comfort over cost.",
  //   customerId: "fe033e91-c9c6-4be7-93b0-10652db7872d", 
  //   conversationId: "conv_fe033e91-c9c6-4be7-93b0-10652db7872d_1763574759906",
  // },
  // {
  //   id: "family-buyer",
  //   name: "Jennifer Williams",
  //   description: "Needs a vehicle that accommodates children and family needs. Prioritizes safety features, space, reliability, and practicality. Asks about car seats, cargo space, fuel efficiency for long trips. May need to fit multiple car seats or strollers. Values durability and family-friendly features.",
  //   customerId: "bc69383f-306b-484d-8a50-151c44f92d1f", 
  //   conversationId: "conv_bc69383f-306b-484d-8a50-151c44f92d1f_1763574762714",
  // },
  // {
  //   id: "tech-enthusiast",
  //   name: "Alex Rodriguez",
  //   description: "Interested in electric vehicles, hybrids, or vehicles with the latest technology. Asks about battery range, charging infrastructure, autonomous driving features, infotainment systems, and connectivity. Environmentally conscious, tech-savvy, wants cutting-edge features. May ask technical questions about specifications.",
  //   customerId: "d4049b1e-22a5-4f8f-9f58-ac5eba7a6746", 
  //   conversationId: "conv_d4049b1e-22a5-4f8f-9f58-ac5eba7a6746_1763574765334",
  // },
];

export function getPersonaById(id: string): Persona | undefined {
  return personas.find((p) => p.id === id);
}

export function getPersonaDescription(id: string): string {
  const persona = getPersonaById(id);
  return persona ? persona.description : "";
}

