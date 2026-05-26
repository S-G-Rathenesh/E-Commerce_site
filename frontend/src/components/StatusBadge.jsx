import React from 'react';

const StatusBadge = ({ status }) => {
  const statusClasses = {
    pending: 'bg-yellow-200 text-yellow-800',
    shipped: 'bg-blue-200 text-blue-800',
    delivered: 'bg-green-200 text-green-800',
    cancelled: 'bg-red-200 text-red-800',
  };

  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusClasses[status] || 'bg-gray-200 text-gray-800'}`}>
      {status}
    </span>
  );
};

export default StatusBadge;