export function formatCnpjDisplay(raw) {
    const d = raw.replace(/\D/g, '');
    if (d.length !== 14)
        return raw.trim();
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}
export function whatsAppHref(digits) {
    const d = digits.replace(/\D/g, '');
    return d ? `https://wa.me/${d}` : '';
}
export function formatWhatsAppDisplay(digits) {
    const d = digits.replace(/\D/g, '');
    if (d.length === 13 && d.startsWith('55')) {
        return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
    }
    if (d.length === 11) {
        return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    }
    return digits;
}
