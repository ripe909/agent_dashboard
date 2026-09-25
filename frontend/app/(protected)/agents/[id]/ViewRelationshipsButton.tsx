'use client';
import { useState } from 'react';
import { Share2 } from 'lucide-react';
import AgentRelationshipsModal from '@/components/AgentRelationshipsModal';

interface Props {
  agentId: string;
  agentName: string;
  owner: { name: string; email: string } | null;
}

export default function ViewRelationshipsButton({ agentId, agentName, owner }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-4 py-2 bg-[#1662dd] hover:bg-blue-600 text-white text-sm font-semibold rounded-lg transition-colors"
      >
        <Share2 className="w-3.5 h-3.5" /> View Relationships
      </button>
      {open && (
        <AgentRelationshipsModal
          agentId={agentId}
          agentName={agentName}
          owner={owner}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
