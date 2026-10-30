export const tenantChargeReadSelect = {
  id: true,
  gymId: true,
  studentId: true,
  subscriptionId: true,
  amount: true,
  dueDate: true,
  paidAt: true,
  status: true,
  paymentMethod: true,
  gatewayConnectionId: true,
  gatewayProviderCode: true,
  student: {
    select: {
      id: true,
      gymId: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
        },
      },
    },
  },
  subscription: {
    select: {
      id: true,
      gymId: true,
      studentId: true,
      planName: true,
      amount: true,
      status: true,
      nextBillingAt: true,
    },
  },
} as const;
