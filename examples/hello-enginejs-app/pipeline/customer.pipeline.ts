export default {
  customer: {
    create: {
      beforeValidate: [
        {
          op: 'lowercase',
          field: 'email',
        },
      ],
    },
    update: {
      beforeValidate: [
        {
          op: 'lowercase',
          field: 'email',
        },
      ],
    },
  },
} as const;
