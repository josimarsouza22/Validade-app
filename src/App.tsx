/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, FormEvent, useRef, ChangeEvent } from 'react';
import { 
  Package, 
  Plus, 
  Calendar, 
  AlertTriangle, 
  Trash2, 
  Search,
  Clock,
  CheckCircle2,
  FileUp,
  Pencil,
  FileText,
  ChevronLeft,
  ChevronRight,
  Download
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { db } from './firebase';
import { collection, getDocs, setDoc, doc, deleteDoc, writeBatch } from 'firebase/firestore';

interface Product {
  id: string;
  code: string;
  name: string;
  expirationDate: string;
  quantity: number;
}

export default function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [newProduct, setNewProduct] = useState({ code: '', name: '', expirationDate: '', quantity: 1 });
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'expired' | 'near' | 'on-track'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initial load from Firebase and fallback to localStorage
  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, 'products'));
        const data = querySnapshot.docs.map(doc => doc.data() as Product);
        setProducts(data);
        localStorage.setItem('products', JSON.stringify(data));
      } catch (error) {
        console.error('Firebase error, loading from localStorage:', error);
        const saved = localStorage.getItem('products');
        if (saved) setProducts(JSON.parse(saved));
      } finally {
        setLoading(false);
      }
    };
    fetchProducts();
  }, []);

  // Sync localStorage whenever products change locally
  useEffect(() => {
    if (!loading) {
      localStorage.setItem('products', JSON.stringify(products));
    }
  }, [products, loading]);

  const calculateDaysRemaining = (expirationDate: string) => {
    if (!expirationDate) return 0;
    
    // Parse YYYY-MM-DD manually to avoid timezone shifts
    const parts = expirationDate.split('-');
    if (parts.length !== 3) return 0;
    
    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]) - 1;
    const day = parseInt(parts[2]);
    
    const exp = new Date(year, month, day);
    exp.setHours(0, 0, 0, 0);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const diffTime = exp.getTime() - today.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const formatDateBR = (dateStr: string) => {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return dateStr;
  };

  const currentDate = new Date();
  const formattedCurrentDate = currentDate.toLocaleDateString('pt-BR');

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const bstr = evt.target?.result;
      const wb = XLSX.read(bstr, { type: 'binary', cellDates: true });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      // Lê a planilha como uma matriz (array de arrays) para pegar colunas exatas (A, B, C)
      const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];

      // Ignora a linha 1 (cabeçalho) e lê a partir da linha 2 (index 1)
      const parsedProducts: Product[] = data.slice(1).map((row: any[]) => {
        const code = row[0] || ''; // Coluna A
        const name = row[1] || 'Produto importado'; // Coluna B
        let expDate = row[2] || ''; // Coluna C
        const quantity = parseInt(row[3]) || 1; // Coluna D

        if (expDate instanceof Date) {
          const year = expDate.getFullYear();
          const month = String(expDate.getMonth() + 1).padStart(2, '0');
          const day = String(expDate.getDate()).padStart(2, '0');
          expDate = `${year}-${month}-${day}`;
        } else if (typeof expDate === 'string') {
          if (expDate.includes('/')) {
            const parts = expDate.split('/');
            if (parts.length === 3) {
              expDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
            }
          }
        } else if (typeof expDate === 'number') {
          const date = new Date(Math.round((expDate - 25569) * 86400 * 1000));
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          expDate = `${year}-${month}-${day}`;
        }

        return {
          id: crypto.randomUUID(),
          code: String(code).trim(),
          name: String(name).trim(),
          expirationDate: String(expDate).trim(),
          quantity: quantity
        };
      }).filter(p => p.code && p.expirationDate);

      // Lógica de desduplicação estrita:
      const existingSignatures = new Set(products.map(p => `${p.code}-${p.expirationDate}`));
      const newProductsToImport: Product[] = [];
      const processedSignatures = new Set<string>();

      for (const p of parsedProducts) {
        const signature = `${p.code}-${p.expirationDate}`;
        
        // Se a planilha tem várias linhas iguais, pega só a primeira e ignora o resto
        if (processedSignatures.has(signature)) {
          continue;
        }
        processedSignatures.add(signature);

        // Se já existe no app com mesmo código e data, NÃO IMPORTA (ignora a linha)
        if (existingSignatures.has(signature)) {
          continue;
        }
        
        // Se não existe, é um produto novo (ou mesmo código com data diferente)
        newProductsToImport.push(p);
      }

      if (newProductsToImport.length > 0) {
        // Sync with Firebase
        try {
          const batch = writeBatch(db);
          
          newProductsToImport.forEach(p => {
            batch.set(doc(db, 'products', p.id), p);
          });
          
          await batch.commit();
          
          // Atualiza o estado local
          setProducts(prev => [...prev, ...newProductsToImport]);
          
          alert(`${newProductsToImport.length} novos produtos importados com sucesso!`);
        } catch (error) {
          console.error('Failed to sync bulk import:', error);
          alert('Falha ao sincronizar com o banco de dados.');
        }
      } else {
        alert('Nenhuma linha nova importada. Todas as linhas já existem ou são duplicadas.');
      }
      
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsBinaryString(file);
  };

  const handleAddProduct = async (e: FormEvent) => {
    e.preventDefault();
    if (!newProduct.code || !newProduct.name || !newProduct.expirationDate || !newProduct.quantity) return;

    if (editingProduct) {
      const updatedProduct = { ...editingProduct, ...newProduct };
      try {
        await setDoc(doc(db, 'products', editingProduct.id), updatedProduct);
        setProducts(products.map(p => p.id === editingProduct.id ? updatedProduct : p));
      } catch (error) {
        console.error('Failed to update on Firebase:', error);
        setProducts(products.map(p => p.id === editingProduct.id ? updatedProduct : p));
      }
      setEditingProduct(null);
    } else {
      const product: Product = {
        id: crypto.randomUUID(),
        ...newProduct
      };
      try {
        await setDoc(doc(db, 'products', product.id), product);
        setProducts([...products, product]);
      } catch (error) {
        console.error('Failed to save to Firebase:', error);
        setProducts([...products, product]);
      }
    }

    setNewProduct({ code: '', name: '', expirationDate: '', quantity: 1 });
    setIsModalOpen(false);
  };

  const startEditing = (product: Product) => {
    setEditingProduct(product);
    setNewProduct({ code: product.code, name: product.name, expirationDate: product.expirationDate, quantity: product.quantity || 1 });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingProduct(null);
    setNewProduct({ code: '', name: '', expirationDate: '', quantity: 1 });
  };

  const removeProduct = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'products', id));
      setProducts(products.filter(p => p.id !== id));
    } catch (error) {
      console.error('Failed to delete from Firebase:', error);
      setProducts(products.filter(p => p.id !== id));
    }
  };

  const removeExpiredProducts = async (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    const expiredProducts = products.filter(p => calculateDaysRemaining(p.expirationDate) <= 0);
    
    if (expiredProducts.length === 0) {
      return;
    }

    // Custom confirmation to avoid iframe blocking window.confirm
    if (!confirmingClear) {
      setConfirmingClear(true);
      setTimeout(() => setConfirmingClear(false), 3000); // Reset after 3 seconds
      return;
    }

    const ids = expiredProducts.map(p => p.id);
    setIsDeleting(true);

    try {
      const batch = writeBatch(db);
      ids.forEach(id => {
        batch.delete(doc(db, 'products', id));
      });
      await batch.commit();

      setProducts(prev => prev.filter(p => !ids.includes(p.id)));
    } catch (error) {
      console.error('Failed to bulk delete from Firebase:', error);
      // Fallback to local delete if Firebase fails
      setProducts(prev => prev.filter(p => !ids.includes(p.id)));
    } finally {
      setIsDeleting(false);
      setConfirmingClear(false);
    }
  };

  const filteredProducts = products
    .filter(p => {
      const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                           p.code.toLowerCase().includes(searchTerm.toLowerCase());
      
      if (!matchesSearch) return false;

      const daysRemaining = calculateDaysRemaining(p.expirationDate);
      if (filterStatus === 'expired') return daysRemaining <= 0;
      if (filterStatus === 'near') return daysRemaining > 0 && daysRemaining <= 30;
      if (filterStatus === 'on-track') return daysRemaining > 30;
      return true;
    })
    .sort((a, b) => new Date(a.expirationDate).getTime() - new Date(b.expirationDate).getTime());

  const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);
  const paginatedProducts = filteredProducts.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const exportToPDF = () => {
    const doc = new jsPDF();
    
    // Título do Relatório
    doc.setFontSize(20);
    doc.setTextColor(79, 70, 229); // Indigo-600
    doc.text('Relatório de Validade de Produtos', 14, 22);
    
    // Informações do Filtro e Resumo
    doc.setFontSize(11);
    doc.setTextColor(100);
    const filterText = filterStatus === 'expired' ? 'Produtos Vencidos' :
                       filterStatus === 'near' ? 'Produtos Próximos ao Vencimento (1-30 dias)' : 
                       filterStatus === 'on-track' ? 'Produtos em Dia (> 30 dias)' : 
                       'Todos os Produtos Cadastrados';
    
    doc.text(`Filtro: ${filterText}`, 14, 32);
    doc.text(`Data de Emissão: ${formattedCurrentDate}`, 14, 38);
    doc.text(`Total de Itens no Relatório: ${filteredProducts.length}`, 14, 44);
    
    // Linha separadora
    doc.setDrawColor(226, 232, 240);
    doc.line(14, 48, 196, 48);
    
    const tableData = filteredProducts.map(p => [
      p.code,
      p.name,
      formatDateBR(p.expirationDate),
      p.quantity || 1,
      `${calculateDaysRemaining(p.expirationDate)} dias`
    ]);

    autoTable(doc, {
      startY: 52,
      head: [['Código', 'Produto', 'Vencimento', 'Qtd', 'Dias Restantes']],
      body: tableData,
      theme: 'grid',
      headStyles: { 
        fillColor: [79, 70, 229], 
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        halign: 'center'
      },
      styles: { 
        fontSize: 10, 
        cellPadding: 4,
        valign: 'middle'
      },
      columnStyles: {
        0: { cellWidth: 35, halign: 'center' },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 35, halign: 'center' },
        3: { cellWidth: 20, halign: 'center' },
        4: { cellWidth: 35, halign: 'center' }
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252]
      },
      didParseCell: (data) => {
        // Destacar em vermelho no PDF se os dias forem <= 30
        if (data.section === 'body' && data.column.index === 4) {
          const daysText = data.cell.raw as string;
          const days = parseInt(daysText);
          if (days <= 30) {
            data.cell.styles.textColor = [220, 38, 38]; // Red-600
            data.cell.styles.fontStyle = 'bold';
          }
        }
      }
    });

    const dateStr = new Date().toISOString().split('T')[0];
    doc.save(`relatorio-validade-${filterStatus}-${dateStr}.pdf`);
  };

  const exportBackup = () => {
    if (products.length === 0) {
      alert('Não há produtos para exportar.');
      return;
    }

    // Preparar os dados para o Excel
    const dataToExport = products.map(p => ({
      'Código': p.code,
      'Nome': p.name,
      'Quantidade': p.quantity || 1,
      'Vencimento': formatDateBR(p.expirationDate)
    }));

    // Criar a planilha
    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Produtos");

    // Gerar o arquivo e baixar
    const dateStr = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `backup-produtos-${dateStr}.xlsx`);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
              <Package className="w-8 h-8 text-indigo-600" />
              Controle de Validade
            </h1>
            <p className="text-slate-500 mt-1 flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Hoje: <span className="font-medium">{formattedCurrentDate}</span>
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                type="text" 
                placeholder="Buscar produto..."
                className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all w-full md:w-64"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileUpload} 
              accept=".xlsx, .xls, .csv" 
              className="hidden" 
            />
            <button 
              onClick={exportToPDF}
              className="flex items-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-xl font-medium transition-colors shadow-sm"
              title="Exportar relatório em PDF"
            >
              <FileText className="w-4 h-4 text-red-500" />
              PDF
            </button>
            <button 
              onClick={exportBackup}
              className="flex items-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-xl font-medium transition-colors shadow-sm"
              title="Exportar backup em Excel"
            >
              <Download className="w-4 h-4 text-emerald-600" />
              Backup
            </button>
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-xl font-medium transition-colors shadow-sm"
              title="Importar produtos de uma planilha"
            >
              <FileUp className="w-4 h-4 text-indigo-500" />
              Importar
            </button>
            <button 
              onClick={() => setIsModalOpen(true)}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl font-medium transition-colors shadow-sm"
            >
              <Plus className="w-4 h-4" />
              Novo Produto
            </button>
          </div>
        </header>

        {/* Stats Summary */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <button 
            onClick={() => setFilterStatus('all')}
            className={`text-left transition-all ${filterStatus === 'all' ? 'ring-2 ring-indigo-500 ring-offset-2' : ''}`}
          >
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:border-indigo-200 transition-colors h-full">
              <div className="flex items-center justify-between mb-2">
                <span className="text-slate-500 text-xs font-medium uppercase tracking-wider">Total</span>
                <Package className="w-4 h-4 text-indigo-500" />
              </div>
              <p className="text-2xl font-bold">{products.length}</p>
            </div>
          </button>

          <button 
            onClick={() => setFilterStatus('expired')}
            className={`text-left transition-all ${filterStatus === 'expired' ? 'ring-2 ring-red-500 ring-offset-2' : ''}`}
          >
            <div className={`bg-white p-5 rounded-2xl border shadow-sm transition-colors h-full ${products.filter(p => calculateDaysRemaining(p.expirationDate) <= 0).length > 0 ? 'border-red-200 bg-red-50/30' : 'border-slate-200'} ${filterStatus === 'expired' ? 'border-red-300' : ''}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-slate-500 text-xs font-medium uppercase tracking-wider">Vencidos</span>
                <AlertTriangle className={`w-4 h-4 ${products.filter(p => calculateDaysRemaining(p.expirationDate) <= 0).length > 0 ? 'text-red-500' : 'text-slate-300'}`} />
              </div>
              <p className={`text-2xl font-bold ${products.filter(p => calculateDaysRemaining(p.expirationDate) <= 0).length > 0 ? 'text-red-600' : 'text-slate-400'}`}>
                {products.filter(p => calculateDaysRemaining(p.expirationDate) <= 0).length}
              </p>
            </div>
          </button>
          
          <button 
            onClick={() => setFilterStatus('near')}
            className={`text-left transition-all ${filterStatus === 'near' ? 'ring-2 ring-amber-500 ring-offset-2' : ''}`}
          >
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:border-amber-200 transition-colors h-full">
              <div className="flex items-center justify-between mb-2">
                <span className="text-slate-500 text-xs font-medium uppercase tracking-wider">Próximos (1-30d)</span>
                <Clock className="w-4 h-4 text-amber-500" />
              </div>
              <p className="text-2xl font-bold text-amber-600">
                {products.filter(p => {
                  const days = calculateDaysRemaining(p.expirationDate);
                  return days > 0 && days <= 30;
                }).length}
              </p>
            </div>
          </button>

          <button 
            onClick={() => setFilterStatus('on-track')}
            className={`text-left transition-all ${filterStatus === 'on-track' ? 'ring-2 ring-emerald-500 ring-offset-2' : ''}`}
          >
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:border-emerald-200 transition-colors h-full">
              <div className="flex items-center justify-between mb-2">
                <span className="text-slate-500 text-xs font-medium uppercase tracking-wider">Em Dia</span>
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              </div>
              <p className="text-2xl font-bold text-emerald-600">
                {products.filter(p => calculateDaysRemaining(p.expirationDate) > 30).length}
              </p>
            </div>
          </button>
        </div>

        {/* Filter Tabs UI */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-2 bg-slate-200/50 p-1 rounded-xl w-fit">
            <button 
              onClick={() => setFilterStatus('all')}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                filterStatus === 'all' 
                  ? 'bg-white text-slate-900 shadow-sm' 
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Todos
            </button>
            <button 
              onClick={() => setFilterStatus('expired')}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${
                filterStatus === 'expired' 
                  ? 'bg-white text-red-600 shadow-sm' 
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <div className="w-2 h-2 rounded-full bg-red-500" />
              Vencidos
            </button>
            <button 
              onClick={() => setFilterStatus('near')}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${
                filterStatus === 'near' 
                  ? 'bg-white text-amber-600 shadow-sm' 
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <div className="w-2 h-2 rounded-full bg-amber-500" />
              Próximos
            </button>
            <button 
              onClick={() => setFilterStatus('on-track')}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${
                filterStatus === 'on-track' 
                  ? 'bg-white text-emerald-600 shadow-sm' 
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              Em Dia
            </button>
          </div>

          {products.some(p => calculateDaysRemaining(p.expirationDate) <= 0) && (
            <button
              onClick={removeExpiredProducts}
              disabled={isDeleting}
              className={`flex items-center gap-2 text-red-600 hover:text-red-700 font-medium text-sm px-4 py-2 rounded-xl hover:bg-red-50 transition-all border border-transparent hover:border-red-100 ${isDeleting ? 'opacity-50 cursor-not-allowed' : ''} ${confirmingClear ? 'bg-red-100 ring-2 ring-red-500' : ''}`}
            >
              <Trash2 className={`w-4 h-4 ${isDeleting ? 'animate-spin' : ''}`} />
              {isDeleting ? 'Excluindo...' : confirmingClear ? 'Clique para Confirmar' : 'Limpar Vencidos'}
            </button>
          )}
        </div>

        {/* Product Table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-bottom border-slate-200">
                  <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Código</th>
                  <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Produto</th>
                  <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Vencimento</th>
                  <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Quantidade</th>
                  <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Dias Restantes</th>
                  <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <AnimatePresence mode="popLayout">
                  {paginatedProducts.map((product) => {
                    const daysRemaining = calculateDaysRemaining(product.expirationDate);
                    const isExpired = daysRemaining <= 0;
                    const isNear = daysRemaining > 0 && daysRemaining <= 30;
                    
                    return (
                      <motion.tr 
                        key={product.id}
                        layout
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className={`hover:bg-slate-50/50 transition-colors group ${isExpired ? 'bg-red-50/30' : ''}`}
                      >
                        <td className="px-6 py-4 whitespace-nowrap font-mono text-sm text-slate-600">
                          {product.code}
                        </td>
                        <td className={`px-6 py-4 whitespace-nowrap font-medium ${isExpired ? 'text-red-700' : ''}`}>
                          {product.name}
                          {isExpired && <span className="ml-2 text-[10px] bg-red-600 text-white px-1.5 py-0.5 rounded uppercase font-bold">Vencido</span>}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">
                          {formatDateBR(product.expirationDate)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 font-medium">
                          {product.quantity || 1}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${
                            isExpired 
                              ? 'bg-red-600 text-white animate-pulse' 
                              : isNear
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-emerald-100 text-emerald-700'
                          }`}>
                            <Clock className="w-3.5 h-3.5" />
                            {isExpired ? 'VENCIDO' : `${daysRemaining} dias`}
                            {(isExpired || isNear) && <AlertTriangle className="w-3.5 h-3.5 ml-0.5" />}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button 
                              onClick={() => startEditing(product)}
                              className="p-2 text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 rounded-lg transition-all border border-indigo-100 shadow-sm"
                              title="Editar produto"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => removeProduct(product.id)}
                              className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-all border border-red-100 shadow-sm"
                              title="Excluir produto"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
                {filteredProducts.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                      Nenhum produto encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          
          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
              <p className="text-sm text-slate-500">
                Mostrando <span className="font-medium">{(currentPage - 1) * itemsPerPage + 1}</span> a <span className="font-medium">{Math.min(currentPage * itemsPerPage, filteredProducts.length)}</span> de <span className="font-medium">{filteredProducts.length}</span> resultados
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                  disabled={currentPage === 1}
                  className="p-2 rounded-lg hover:bg-white hover:shadow-sm disabled:opacity-50 disabled:hover:bg-transparent transition-all"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`w-10 h-10 rounded-lg text-sm font-semibold transition-all ${
                      currentPage === page 
                        ? 'bg-indigo-600 text-white shadow-md' 
                        : 'hover:bg-white hover:shadow-sm text-slate-600'
                    }`}
                  >
                    {page}
                  </button>
                ))}

                <button
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  className="p-2 rounded-lg hover:bg-white hover:shadow-sm disabled:opacity-50 disabled:hover:bg-transparent transition-all"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal for adding new product */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeModal}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100">
                <h2 className="text-xl font-bold">
                  {editingProduct ? 'Editar Produto' : 'Cadastrar Novo Produto'}
                </h2>
              </div>
              <form onSubmit={handleAddProduct} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Código do Produto</label>
                  <input 
                    required
                    type="text" 
                    className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                    placeholder="Ex: PRD001"
                    value={newProduct.code}
                    onChange={(e) => setNewProduct({...newProduct, code: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Nome do Produto</label>
                  <input 
                    required
                    type="text" 
                    className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                    placeholder="Ex: Leite Integral"
                    value={newProduct.name}
                    onChange={(e) => setNewProduct({...newProduct, name: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Data de Vencimento</label>
                  <input 
                    required
                    type="date" 
                    className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                    value={newProduct.expirationDate}
                    onChange={(e) => setNewProduct({...newProduct, expirationDate: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Quantidade</label>
                  <input 
                    required
                    type="number" 
                    min="1"
                    className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                    value={newProduct.quantity || 1}
                    onChange={(e) => setNewProduct({...newProduct, quantity: Number(e.target.value)})}
                  />
                </div>
                <div className="flex gap-3 pt-4">
                  <button 
                    type="button"
                    onClick={closeModal}
                    className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 rounded-xl font-medium hover:bg-slate-50 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors shadow-sm"
                  >
                    {editingProduct ? 'Atualizar Produto' : 'Salvar Produto'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
