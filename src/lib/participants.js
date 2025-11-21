/**
 * Hardcoded list of Secret Santa participants
 * This is the source of truth for who can participate
 */

export const PARTICIPANTS = [
    { name: 'Jed', email: 'jed.piezas@gmail.com' },
    { name: 'Natalie', email: 'ncammarasana@gmail.com' },
    { name: 'Chinh', email: 'chinhhuynhlmft@gmail.com' },
    { name: 'Gaby', email: 'gabrielle@glim.ca' },
    { name: 'Jana', email: 'jana.j.maclaren@gmail.com' },
    { name: 'Peter', email: 'peter.planta@gmail.com' },
    { name: 'Louis', email: 'ldeschner@gmail.com' },
    { name: 'Genevieve', email: 'genevieve.ayukawa@gmail.com' }
];

// Helper to get email by name (case-insensitive)
export function getParticipantEmail(name) {
    const participant = PARTICIPANTS.find(
        p => p.name.toLowerCase() === name.toLowerCase()
    );
    return participant?.email || null;
}

// Helper to get name by email (case-insensitive)
export function getParticipantName(email) {
    const participant = PARTICIPANTS.find(
        p => p.email.toLowerCase() === email.toLowerCase()
    );
    return participant?.name || null;
}

// Get list of participant names only
export function getParticipantNames() {
    return PARTICIPANTS.map(p => p.name);
}
