import { useState } from 'react'
import { Check, Edit2, Plus, Power, Trash2, X } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Modal } from '../../components/ui/Modal'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States'
import { apiFetch } from '../../lib/api'

export type CategoryItem = {
  _id: string
  name: string
  normalizedName: string
  isActive: boolean
  createdBy?: { name?: string }
  updatedBy?: { name?: string }
  createdAt: string
  updatedAt: string
}

export function CategorySettings() {
  const queryClient = useQueryClient()
  const [dialog, setDialog] = useState<'create' | 'edit' | null>(null)
  const [editingCategory, setEditingCategory] = useState<CategoryItem | null>(null)
  const [nameInput, setNameInput] = useState('')
  const [localError, setLocalError] = useState('')

  const categoriesQuery = useQuery({
    queryKey: ['categories', 'all'],
    queryFn: () => apiFetch<CategoryItem[]>('/categories'),
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['categories'] })
    void queryClient.invalidateQueries({ queryKey: ['clients'] })
    void queryClient.invalidateQueries({ queryKey: ['report-options'] })
  }

  const createMutation = useMutation({
    mutationFn: (body: { name: string }) =>
      apiFetch<CategoryItem>('/categories', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      invalidate()
      setDialog(null)
      setNameInput('')
      setLocalError('')
    },
    onError: (err: Error) => {
      setLocalError(err.message)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { name?: string; isActive?: boolean } }) =>
      apiFetch<CategoryItem>(`/categories/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => {
      invalidate()
      setDialog(null)
      setEditingCategory(null)
      setNameInput('')
      setLocalError('')
    },
    onError: (err: Error) => {
      setLocalError(err.message)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch<{ message: string }>(`/categories/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidate()
      setLocalError('')
    },
    onError: (err: Error) => {
      setLocalError(err.message)
    },
  })

  const categories = categoriesQuery.data ?? []

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError('')
    const trimmed = nameInput.trim()
    if (!trimmed) {
      setLocalError('Category name is required')
      return
    }

    const duplicate = categories.some(
      (c) => c.normalizedName === trimmed.toLowerCase(),
    )
    if (duplicate) {
      setLocalError(`A category with the name "${trimmed}" already exists`)
      return
    }

    createMutation.mutate({ name: trimmed })
  }

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingCategory) return
    setLocalError('')
    const trimmed = nameInput.trim()
    if (!trimmed) {
      setLocalError('Category name cannot be empty')
      return
    }

    const duplicate = categories.some(
      (c) => c._id !== editingCategory._id && c.normalizedName === trimmed.toLowerCase(),
    )
    if (duplicate) {
      setLocalError(`A category with the name "${trimmed}" already exists`)
      return
    }

    updateMutation.mutate({ id: editingCategory._id, body: { name: trimmed } })
  }

  const handleToggleStatus = (category: CategoryItem) => {
    setLocalError('')
    const nextStatus = !category.isActive
    const actionLabel = nextStatus ? 'activate' : 'deactivate'
    if (!window.confirm(`Are you sure you want to ${actionLabel} "${category.name}"?`)) return
    updateMutation.mutate({ id: category._id, body: { isActive: nextStatus } })
  }

  const handleDelete = (category: CategoryItem) => {
    setLocalError('')
    if (!window.confirm(`Are you sure you want to delete "${category.name}"? This cannot be undone.`)) return
    deleteMutation.mutate(category._id)
  }

  if (categoriesQuery.isLoading) return <LoadingState />
  if (categoriesQuery.isError) return <ErrorState description="Unable to load categories." />

  return (
    <Card>
      <div className="section-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2>Category Master</h2>
          <p>Create and manage standardized client categories across the organisation.</p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setNameInput('')
            setLocalError('')
            setDialog('create')
          }}
        >
          <Plus size={15} /> Add category
        </Button>
      </div>

      {localError && (
        <div style={{ margin: '0.75rem 0' }}>
          <p className="form-error" role="alert">{localError}</p>
        </div>
      )}

      {categories.length === 0 ? (
        <EmptyState
          title="No categories defined"
          description="Click 'Add category' to establish your first client category."
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Category Name</th>
                <th>Status</th>
                <th>Created By</th>
                <th>Last Updated</th>
                <th aria-label="Actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((item) => (
                <tr key={item._id}>
                  <td>
                    <strong>{item.name}</strong>
                  </td>
                  <td>
                    <Badge tone={item.isActive ? 'success' : 'neutral'}>
                      {item.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </td>
                  <td>{item.createdBy?.name ?? '—'}</td>
                  <td>{new Date(item.updatedAt || item.createdAt).toLocaleDateString()}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-label={`Edit ${item.name}`}
                        onClick={() => {
                          setEditingCategory(item)
                          setNameInput(item.name)
                          setLocalError('')
                          setDialog('edit')
                        }}
                      >
                        <Edit2 size={13} /> Edit
                      </Button>
                      <Button
                        variant={item.isActive ? 'secondary' : 'primary'}
                        size="sm"
                        aria-label={item.isActive ? `Deactivate ${item.name}` : `Activate ${item.name}`}
                        onClick={() => handleToggleStatus(item)}
                      >
                        <Power size={13} /> {item.isActive ? 'Deactivate' : 'Activate'}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        aria-label={`Delete ${item.name}`}
                        onClick={() => handleDelete(item)}
                      >
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog === 'create' && (
        <Modal title="Add category" onClose={() => setDialog(null)}>
          <form className="modal-form" onSubmit={handleCreateSubmit}>
            <label>
              Category name
              <input
                type="text"
                value={nameInput}
                onChange={(e) => {
                  setNameInput(e.target.value)
                  setLocalError('')
                }}
                placeholder="e.g., Hospital, Clinic, Pharmacy"
                required
                autoFocus
              />
            </label>
            {localError && <p className="form-error" role="alert">{localError}</p>}
            <div className="modal-actions">
              <Button type="button" variant="secondary" onClick={() => setDialog(null)}>
                <X size={14} /> Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                <Check size={14} /> {createMutation.isPending ? 'Saving...' : 'Create category'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {dialog === 'edit' && editingCategory && (
        <Modal title={`Edit category: ${editingCategory.name}`} onClose={() => setDialog(null)}>
          <form className="modal-form" onSubmit={handleEditSubmit}>
            <label>
              Category name
              <input
                type="text"
                value={nameInput}
                onChange={(e) => {
                  setNameInput(e.target.value)
                  setLocalError('')
                }}
                required
                autoFocus
              />
            </label>
            {localError && <p className="form-error" role="alert">{localError}</p>}
            <div className="modal-actions">
              <Button type="button" variant="secondary" onClick={() => setDialog(null)}>
                <X size={14} /> Cancel
              </Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                <Check size={14} /> {updateMutation.isPending ? 'Saving...' : 'Update category'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </Card>
  )
}

