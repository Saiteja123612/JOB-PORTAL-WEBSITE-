export const categories=['Engineering','Design','Data','Marketing','Sales','Finance','HR','Operations','Customer Support','Product','Healthcare','Education','Cybersecurity'];

const sampleRoles=[
  ['Cloudnest Labs','Cloud Platform Engineer','Engineering','Bengaluru','Hybrid','AWS,Docker,Linux',3,6,18,30],
  ['Cloudnest Labs','Graduate Software Engineer','Engineering','Hyderabad','On-site','JavaScript,SQL,Git',0,1,5,9],
  ['Pixelgrove Studio','Interaction Designer','Design','Pune','Hybrid','Figma,Prototyping,Accessibility',2,4,10,18],
  ['Pixelgrove Studio','Visual Design Intern','Design','Remote','Remote','Typography,Figma,Illustration',0,1,2,4],
  ['Quantleaf Analytics','Data Scientist','Data','Bengaluru','Hybrid','Python,Statistics,Machine learning',2,5,16,28],
  ['Quantleaf Analytics','Business Intelligence Analyst','Data','Chennai','On-site','SQL,Power BI,Excel',1,3,7,13],
  ['Brighttrail Media','Content Strategist','Marketing','Remote','Remote','Content,SEO,Research',2,4,8,15],
  ['Brighttrail Media','Performance Marketing Specialist','Marketing','Mumbai','Hybrid','Google Ads,Analytics,Copywriting',1,3,7,12],
  ['Leadwell Systems','Account Executive','Sales','Gurugram','Hybrid','Sales,CRM,Negotiation',2,5,10,20],
  ['Leadwell Systems','Sales Development Associate','Sales','Hyderabad','On-site','Communication,Prospecting,CRM',0,2,4,7],
  ['Ledgerbloom Finance','Financial Analyst','Finance','Mumbai','Hybrid','Excel,Forecasting,Financial modeling',2,4,9,17],
  ['Ledgerbloom Finance','Accounts Associate','Finance','Chennai','On-site','Accounting,Tally,Excel',0,2,3,6],
  ['Peoplepath Works','Talent Acquisition Specialist','HR','Pune','Hybrid','Recruiting,Interviewing,Communication',2,4,6,11],
  ['Peoplepath Works','HR Operations Associate','HR','Noida','On-site','HRIS,Excel,Employee relations',0,2,4,7],
  ['Swiftlane Logistics','Supply Chain Analyst','Operations','Chennai','On-site','Excel,Forecasting,Logistics',1,3,6,11],
  ['Swiftlane Logistics','Operations Manager','Operations','Hyderabad','On-site','Operations,Leadership,Process improvement',4,7,12,20],
  ['Kindred Support','Customer Success Manager','Customer Support','Remote','Remote','Customer success,CRM,Communication',3,5,10,17],
  ['Kindred Support','Customer Support Associate','Customer Support','Bengaluru','Hybrid','Communication,Troubleshooting,Empathy',0,2,3,6],
  ['Northstar Product Co','Product Manager','Product','Bengaluru','Hybrid','Strategy,Analytics,Prioritization',3,6,20,34],
  ['Northstar Product Co','Associate Product Manager','Product','Pune','Hybrid','Research,SQL,Communication',0,2,8,14],
  ['Carevista Health','Healthcare Operations Coordinator','Healthcare','Hyderabad','On-site','Scheduling,Communication,Operations',1,3,5,9],
  ['Carevista Health','Medical Content Editor','Healthcare','Remote','Remote','Medical writing,Editing,Research',2,5,7,13],
  ['Learnloom Academy','Instructional Designer','Education','Remote','Remote','Learning design,Storyboarding,Writing',2,4,7,14],
  ['Learnloom Academy','Learning Support Associate','Education','Jaipur','On-site','Teaching,Communication,Organization',0,2,3,6],
  ['Shieldpine Security','Security Analyst','Cybersecurity','Gurugram','Hybrid','SIEM,Networking,Incident response',1,3,9,16],
  ['Shieldpine Security','Application Security Engineer','Cybersecurity','Remote','Remote','OWASP,Python,Threat modeling',3,6,20,32],
  ['Orbitcraft Technologies','Full Stack Developer','Engineering','Remote','Remote','Node.js,JavaScript,PostgreSQL',2,5,12,24],
  ['Orbitcraft Technologies','QA Automation Engineer','Engineering','Kochi','Hybrid','Playwright,JavaScript,Testing',1,3,6,12],
  ['Greenmesh Energy','Sustainability Analyst','Operations','Ahmedabad','On-site','Research,Excel,Reporting',1,3,6,11],
  ['Greenmesh Energy','Project Coordinator','Operations','Pune','Hybrid','Planning,Communication,Excel',0,2,4,8],
  ['Loomline Commerce','E-commerce Category Manager','Sales','Mumbai','Hybrid','Merchandising,Analytics,Negotiation',3,6,14,23],
  ['Loomline Commerce','Brand Designer','Design','Bengaluru','Hybrid','Branding,Illustration,Figma',2,4,9,16],
  ['Riverbyte AI','Machine Learning Engineer','Data','Hyderabad','Hybrid','Python,PyTorch,MLOps',2,5,18,32],
  ['Riverbyte AI','Technical Writer','Marketing','Remote','Remote','Technical writing,Markdown,APIs',1,4,7,14],
  ['Craftbridge Digital','DevOps Engineer','Engineering','Noida','Hybrid','CI/CD,Docker,AWS',2,4,12,22],
  ['Craftbridge Digital','Frontend Intern','Engineering','Remote','Remote','HTML,CSS,JavaScript',0,1,2,5]
];
const duties={Engineering:'Build reliable, accessible software. Collaborate with product and design, write maintainable tests, and contribute to code reviews.',Design:'Turn research into clear, usable experiences. Explore ideas, prototype interactions, and partner with engineers to deliver polished work.',Data:'Explore datasets, validate assumptions, and explain findings. Build repeatable analysis and help teams make evidence-based decisions.',Marketing:'Understand the audience, develop compelling content and campaigns, and measure results to improve the next iteration.',Sales:'Understand customer needs, develop relationships, and guide prospects through a thoughtful sales process.',Finance:'Prepare accurate analysis and reports, improve financial processes, and communicate findings to business partners.',HR:'Support an inclusive employee experience, maintain accurate records, and collaborate with teams on people processes.',Operations:'Coordinate daily operations, improve workflows, and use clear reporting to identify and resolve bottlenecks.','Customer Support':'Listen carefully to customers, resolve issues clearly, and bring product feedback back to the team.',Product:'Understand customer problems, prioritize useful improvements, and collaborate with design and engineering to ship and measure outcomes.',Healthcare:'Support healthcare teams with clear communication, careful documentation, and reliable coordination. Follow applicable professional standards.',Education:'Create thoughtful learning experiences and help learners make steady progress through clear explanations and practical feedback.',Cybersecurity:'Investigate security risks, document findings, and partner with engineering teams to improve prevention and response.'};

export function expandDemoCatalog(db){
  if(db.prepare("SELECT value FROM portal_settings WHERE key='catalog_v2'").get())return;
  db.exec('BEGIN');
  try{
    // Mark only the original fixture fingerprints; never relabel employer-created jobs.
    for(const [company,title] of [['Linear','Product Designer'],['Notion','Frontend Developer'],['Razorpay','Backend Engineer'],['Spotify','Growth Marketing Manager'],['Figma','UX Research Intern'],['Airbnb','Data Analyst']]) db.prepare("UPDATE jobs SET is_demo=1,work_mode=CASE WHEN location='Remote' THEN 'Remote' ELSE 'Hybrid' END WHERE company=? AND title=? AND employer_id IS NULL").run(company,title);
    const insert=db.prepare('INSERT INTO jobs(title,company,location,type,category,salary_min,salary_max,description,skills,experience_min,experience_max,work_mode,is_demo) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)');
    for(const [company,title,category,location,mode,skills,min,max,low,high] of sampleRoles){
      const type=title.includes('Intern')?'Internship':title==='Technical Writer'?'Contract':'Full-time';
      insert.run(title,company,location,type,category,low*100000,high*100000,`${duties[category]}\n\nWhat you bring\n${skills.split(',').join(', ')}. ${min===0?'Early-career candidates are welcome.':`This example role is designed for ${min}–${max} years of relevant experience.`}\n\nThis is a fictional demonstration opening, not an active vacancy.`,skills,min,max,mode);
    }
    db.prepare("INSERT INTO portal_settings(key,value) VALUES ('catalog_v2','complete')").run();db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
}
