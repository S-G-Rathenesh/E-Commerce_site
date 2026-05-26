export function getFinalDeliveryCharge(pincode) {
    // Dummy implementation
    if (pincode && pincode.length === 6) {
        return 50; // Flat rate
    }
    return 0;
}