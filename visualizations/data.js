// Synthetic sample data. Replace with real branches, members and messages.
window.ORG = {
  name: "Meridian Group",
  branches: [
    { id: "hq", name: "Head Office", members: [
      ["Aino Virtanen", "Director"], ["Jonas Eklund", "Finance lead"], ["Sara Lindqvist", "Policy"],
      ["Mika Heikkilä", "Operations"], ["Lena Ahonen", "Comms"], ["Petri Salo", "Legal"]] },
    { id: "harbour", name: "Harbour Branch", members: [
      ["Oskar Berg", "Branch manager"], ["Ida Nyström", "Logistics"], ["Tuomas Rautio", "Sales"],
      ["Noora Kallio", "Support"], ["Eero Laine", "Planner"], ["Maja Strand", "Analyst"]] },
    { id: "north", name: "Northern Branch", members: [
      ["Henrik Koskela", "Branch manager"], ["Elsa Moilanen", "Field lead"], ["Ville Törmä", "Sales"],
      ["Anni Jokela", "Support"], ["Juho Pelto", "Technician"], ["Sofia Ranta", "Admin"]] },
    { id: "valley", name: "Valley Branch", members: [
      ["Karin Holm", "Branch manager"], ["Antti Niemi", "Engineer"], ["Helmi Lahti", "Sales"],
      ["Otto Saari", "Support"], ["Venla Koivu", "Trainer"], ["Leo Mäkelä", "Analyst"]] },
    { id: "lake", name: "Lakeside Branch", members: [
      ["Emil Forsberg", "Branch manager"], ["Aada Hämäläinen", "Coordinator"], ["Niko Peltola", "Sales"],
      ["Iida Tuomi", "Support"], ["Rasmus Lund", "Technician"], ["Pihla Kari", "Admin"]] }
  ],
  // from/to are "branchId:memberIndex". One message, one sender, several readers.
  messages: [
    { id: 1, topic: "Quarterly targets", day: "Mon", from: "hq:0", to: ["harbour:0","north:0","valley:0","lake:0"] },
    { id: 2, topic: "Budget freeze", day: "Mon", from: "hq:1", to: ["harbour:0","north:0","valley:0","lake:0","hq:3"] },
    { id: 3, topic: "New safety policy", day: "Tue", from: "hq:2", to: ["harbour:0","north:0","valley:0","lake:0","hq:5"] },
    { id: 4, topic: "Safety briefing", day: "Tue", from: "harbour:0", to: ["harbour:1","harbour:2","harbour:3","harbour:4","harbour:5"] },
    { id: 5, topic: "Safety briefing", day: "Tue", from: "north:0", to: ["north:1","north:2","north:3","north:4","north:5"] },
    { id: 6, topic: "Safety briefing", day: "Wed", from: "valley:0", to: ["valley:1","valley:2","valley:3","valley:4","valley:5"] },
    { id: 7, topic: "Safety briefing", day: "Wed", from: "lake:0", to: ["lake:1","lake:2","lake:3","lake:4","lake:5"] },
    { id: 8, topic: "Shipment delay", day: "Wed", from: "harbour:1", to: ["north:1","lake:1","hq:3"] },
    { id: 9, topic: "Customer escalation", day: "Thu", from: "north:3", to: ["harbour:3","valley:3","hq:4"] },
    { id: 10, topic: "Training slots", day: "Thu", from: "valley:4", to: ["north:4","lake:4","harbour:4"] },
    { id: 11, topic: "Spare parts swap", day: "Thu", from: "lake:4", to: ["valley:1","north:4"] },
    { id: 12, topic: "Sales leads", day: "Fri", from: "harbour:2", to: ["north:2","valley:2","lake:2"] },
    { id: 13, topic: "Weekly report", day: "Fri", from: "harbour:5", to: ["hq:1","hq:0"] },
    { id: 14, topic: "Weekly report", day: "Fri", from: "north:5", to: ["hq:1","hq:0"] },
    { id: 15, topic: "Weekly report", day: "Fri", from: "valley:5", to: ["hq:1","hq:0"] },
    { id: 16, topic: "Weekly report", day: "Fri", from: "lake:5", to: ["hq:1"] },
    { id: 17, topic: "Press line", day: "Fri", from: "hq:4", to: ["harbour:0","north:0","valley:0","lake:0"] }
  ]
};
ORG.people = {};
ORG.branches.forEach(b => b.members = b.members.map((m, i) => {
  const p = { key: b.id + ":" + i, branch: b.id, name: m[0], role: m[1], idx: i };
  ORG.people[p.key] = p; return p;
}));
ORG.branchOf = k => ORG.branches.find(b => b.id === k.split(":")[0]);
