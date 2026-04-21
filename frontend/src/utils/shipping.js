const FREE_DELIVERY_THRESHOLD = 500
const STANDARD_DELIVERY_CHARGE = 49

export const getFinalDeliveryCharge = (orderTotal = 0) => {
  return Number(orderTotal) >= FREE_DELIVERY_THRESHOLD ? 0 : STANDARD_DELIVERY_CHARGE
}
