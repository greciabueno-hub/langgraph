// src/types.ts
export type Role = "user" | "assistant"
export type Message = { role: Role; content: string }

export type DiscoveryGoal = {
  id: string
  collected: boolean
  value?: unknown
}

export type DiscoveryContext = {
  goals: DiscoveryGoal[]
  shownRecommendations?: boolean
}

export type ConversationState = {
  conversationId: string
  customerId?: string
  messages: Message[]
  workflowStep?: "INITIAL" | "CUSTOMER_DISCOVERY" | "APPOINTMENT_BOOKING"
  sessionData?: {
    discoveryContext?: DiscoveryContext
    businessHours?: { start: string; end: string; tz: string }
  }
}