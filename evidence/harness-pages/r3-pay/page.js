"use client";
import { RecordPaymentSheet } from "../../../components/RecordPaymentSheet";
export default function Page() {
  return <RecordPaymentSheet p={{ id: "pay1", displayName: "Ava Lane", balance: 150, totalPaid: 50, totalDue: 200, log: [] }} onClose={() => { document.title = "closed"; }} onSaved={() => {}} />;
}
