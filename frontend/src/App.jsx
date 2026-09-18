import { useEffect, useState } from 'react'

export default function App() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/hello')
      .then((res) => {
        if (!res.ok) throw new Error('Network response was not ok')
        return res.json()
      })
      .then((data) => {
        setData(data.message)
        setLoading(false)
      })
      .catch((err) => {
        console.error('Fetch error:', err)
        setLoading(false)
      })
  }, [])

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-4">
      <h1 className="text-3xl font-bold mb-4">React + Flask Connection</h1>
      {loading ? (
        <p>Loading...</p>
      ) : (
        <p className="text-emerald-400 text-xl font-mono">{data || 'Failed to load data.'}</p>
      )}
    </div>
  )
}