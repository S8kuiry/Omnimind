'use client'

import React from 'react'

interface DeleteConfirmationModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
}

export default function DeleteConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
}: DeleteConfirmationModalProps) {
  if (!isOpen) return null

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
      style={{ backdropFilter: 'blur(8px)', background: 'rgba(1, 0, 3, 0.15)' }}
    >
      <div 
        className="w-full max-w-md rounded-2xl border p-6 space-y-6"
        style={{ background: '#010003', borderColor: 'rgba(255, 255, 255, 0.15)' }}
      >
        {/* Header Content */}
        <div className="space-y-2">
          <h3 
            className="text-sm font-medium tracking-wide font-mono uppercase" 
            style={{ color: 'rgba(210,140,160,0.9)' }}
          >
            Confirm Permanent Deletion
          </h3>
          <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.55)' }}>
            Are you sure you want to delete this email from your dashboard? This action will permanently wipe the tracked record from the pipeline server.
          </p>
        </div>

        {/* Modal Action Controls */}
        <div className="flex items-center justify-end gap-3 font-mono text-[11px]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg cursor-pointer transition-colors opacity-60 hover:opacity-100"
            style={{ color: '#fff', background: 'rgba(255,255,255,0.05)' }}
          >
            Cancel
          </button>
          
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg cursor-pointer transition-all hover:brightness-110"
            style={{ 
              background: 'linear-gradient(135deg, rgba(210,140,160,0.8), rgba(180,100,130,0.8))', 
              color: '#010003',
              fontWeight: 600
            }}
          >
            Delete Permanently
          </button>
        </div>
      </div>
    </div>
  )
}