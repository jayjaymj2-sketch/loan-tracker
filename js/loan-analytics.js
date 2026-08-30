(function(root,factory){
  const api=factory();
  if(typeof module==='object' && module.exports) module.exports=api;
  if(root) root.LoanAnalytics=api;
})(typeof self!=='undefined'?self:this,function(){
  function num(value){
    const result=Number(value);
    return Number.isFinite(result)?result:0;
  }

  function orderPaymentEntries(payments){
    return (Array.isArray(payments)?payments:[]).map((payment,index)=>({payment,index})).reverse();
  }

  function monthKeyOffset(referenceDate,offset){
    const source=new Date(String(referenceDate).slice(0,10)+'T00:00:00');
    const date=new Date(source.getFullYear(),source.getMonth()+offset,1);
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
  }

  function buildMonthlySeries(payments,referenceDate,months){
    const count=Math.max(1,Number(months)||12);
    const totals={};
    for(const payment of Array.isArray(payments)?payments:[]){
      const key=String(payment.date||'').slice(0,7);
      if(!/^\d{4}-\d{2}$/.test(key)) continue;
      const row=totals[key]||(totals[key]={amount:0,principal:0,interest:0,count:0});
      row.amount+=num(payment.amount);
      row.principal+=num(payment.principalPaid);
      row.interest+=num(payment.interest);
      row.count+=1;
    }
    const result=[];
    for(let offset=-(count-1);offset<=0;offset++){
      const key=monthKeyOffset(referenceDate,offset);
      result.push(Object.assign({key,amount:0,principal:0,interest:0,count:0},totals[key]||{}));
    }
    return result;
  }

  function getMonthlyPaymentStats(payments,limit){
    const monthlyTotals={};
    for(const payment of Array.isArray(payments)?payments:[]){
      const key=String(payment.date||'').slice(0,7);
      if(!/^\d{4}-\d{2}$/.test(key)) continue;
      monthlyTotals[key]=(monthlyTotals[key]||0)+num(payment.amount);
    }
    const allMonthKeys=Object.keys(monthlyTotals).sort();
    const recentKeys=allMonthKeys.slice(-Math.max(1,Number(limit)||12));
    const basisKeys=recentKeys.length?recentKeys:allMonthKeys;
    const average=basisKeys.length?basisKeys.reduce((sum,key)=>sum+monthlyTotals[key],0)/basisKeys.length:50000;
    return {monthlyTotals,allMonthKeys,basisKeys,average,basisMonths:basisKeys.length};
  }

  function summarizeMonth(payments,referenceDate,goal){
    const row=buildMonthlySeries(payments,referenceDate,1)[0];
    const target=Math.max(0,num(goal));
    const pct=target>0?Math.max(0,Math.min(100,row.amount/target*100)):0;
    return Object.assign({},row,{paid:row.amount,goal:target,pct,remaining:Math.max(target-row.amount,0),goalMet:target>0&&row.amount>=target});
  }

  function buildAnnualInterestSummary(certifiedHistory,payments,lastCertifiedYear,formatDate){
    const formatter=typeof formatDate==='function'?formatDate:(value=>value);
    const summary=(Array.isArray(certifiedHistory)?certifiedHistory:[]).map(item=>Object.assign({},item,{certified:true}));
    const actual={};
    for(const payment of Array.isArray(payments)?payments:[]){
      const year=parseInt(String(payment.date||'').slice(0,4),10);
      if(!Number.isFinite(year)||year<=lastCertifiedYear) continue;
      const row=actual[year]||(actual[year]={year,amount:0,paymentCount:0,lastPaymentDate:''});
      row.amount+=num(payment.interest);
      row.paymentCount+=1;
      if(!row.lastPaymentDate||payment.date>row.lastPaymentDate) row.lastPaymentDate=payment.date;
    }
    Object.keys(actual).map(Number).sort((a,b)=>a-b).forEach(year=>{
      const row=actual[year];
      summary.push({year,amount:Math.round(row.amount*100)/100,paymentCount:row.paymentCount,lastPaymentDate:row.lastPaymentDate,source:`จากรายการชำระจริง ${row.paymentCount} รายการ · ถึง ${formatter(row.lastPaymentDate)}`,certified:false});
    });
    return summary;
  }

  function compareInterestYTD(payments,year,cutoffDate){
    const targetYear=Number(year);
    const cutoff=String(cutoffDate||`${targetYear}-12-31`).slice(5,10);
    let currentAmount=0,previousAmount=0;
    for(const payment of Array.isArray(payments)?payments:[]){
      const date=String(payment.date||'');
      const paymentYear=parseInt(date.slice(0,4),10);
      const monthDay=date.slice(5,10);
      if(monthDay>cutoff) continue;
      if(paymentYear===targetYear) currentAmount+=num(payment.interest);
      if(paymentYear===targetYear-1) previousAmount+=num(payment.interest);
    }
    const delta=currentAmount-previousAmount;
    const pct=previousAmount>0?delta/previousAmount*100:null;
    const asOf=new Date(`${targetYear}-${cutoff}T00:00:00`);
    const start=new Date(targetYear,0,1);
    const end=new Date(targetYear+1,0,1);
    const elapsed=Math.max(1,Math.round((asOf-start)/86400000)+1);
    const days=Math.round((end-start)/86400000);
    const projected=currentAmount/elapsed*days;
    return {year:targetYear,previousYear:targetYear-1,currentAmount,previousAmount,delta,pct,projected,cutoffDate:`${targetYear}-${cutoff}`};
  }

  function filterPaymentEntries(entries,filters,attachmentIds){
    const options=filters||{};
    const query=String(options.query||'').trim().toLowerCase().replace(/,/g,'');
    const year=String(options.year||'all');
    const type=String(options.type||'all');
    const receiptIds=new Set(Array.isArray(attachmentIds)?attachmentIds:[]);
    return (Array.isArray(entries)?entries:[]).filter(entry=>{
      const payment=entry.payment||entry.p||entry;
      if(year!=='all'&&String(payment.date||'').slice(0,4)!==year) return false;
      const hasReceipt=receiptIds.has(String(payment.receiptKey||payment.id||''));
      if(type==='regular'&&num(payment.interest)<=0) return false;
      if(type==='extra'&&!(num(payment.interest)===0&&num(payment.principalPaid)>0)) return false;
      if(type==='receipt'&&!(hasReceipt||payment.source==='receipt-upload')) return false;
      if(!query) return true;
      const searchable=[payment.date,payment.searchText,payment.amount,payment.interest,payment.principalPaid,payment.balanceAfter,payment.source].map(value=>String(value==null?'':value).toLowerCase().replace(/,/g,'')).join(' ');
      return searchable.includes(query);
    });
  }

  function projectPayoffFixedRate(balance,monthlyPayment,annualRate,maxMonths){
    let remaining=Math.max(0,num(balance));
    const payment=Math.max(0,num(monthlyPayment));
    const monthlyRate=Math.max(0,num(annualRate))/12;
    const limit=Math.max(1,Number(maxMonths)||600);
    let months=0,totalInterest=0;
    if(remaining===0) return {months:0,totalInterest:0,remaining:0,finite:true};
    if(payment===0) return {months:Infinity,totalInterest:Infinity,remaining,finite:false};
    while(remaining>0.01&&months<limit){
      const interest=remaining*monthlyRate;
      const principal=payment-interest;
      if(principal<=0) return {months:Infinity,totalInterest:Infinity,remaining,finite:false};
      remaining=Math.max(remaining-Math.min(principal,remaining),0);
      totalInterest+=interest;
      months+=1;
    }
    return {months:remaining<=0.01?months:Infinity,totalInterest:remaining<=0.01?totalInterest:Infinity,remaining,finite:remaining<=0.01};
  }

  return {orderPaymentEntries,buildMonthlySeries,getMonthlyPaymentStats,summarizeMonth,buildAnnualInterestSummary,compareInterestYTD,filterPaymentEntries,projectPayoffFixedRate};
});
