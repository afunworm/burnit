"use strict";(self.webpackChunkburnit=self.webpackChunkburnit||[]).push([[918],{7918:(C,h,r)=>{r.r(h),r.d(h,{ViewModule:()=>M});var g=r(5861),e=r(4946),u=r(1533),a=r(2794),f=r(6288),l=r(95),p=r(6814);function w(o,c){if(1&o){const t=e.EpF();e.TgZ(0,"div",4)(1,"div",5)(2,"h3"),e._uU(3," An error has occurred while retrieving the secret message. Please contact the developer. "),e.qZA(),e.TgZ(4,"p"),e._uU(5," Ctrl + S or "),e.TgZ(6,"a",6),e.NdJ("click",function(){e.CHM(t);const s=e.oxw();return e.KtG(s.navigateToCreate())}),e._uU(7,"click here"),e.qZA(),e._uU(8," to start a new message. "),e.qZA()()()}}function m(o,c){if(1&o){const t=e.EpF();e.TgZ(0,"div",7)(1,"div",8),e._uU(2),e.TgZ(3,"a",6),e.NdJ("click",function(){e.CHM(t);const s=e.oxw();return e.KtG(s.navigateToCreate())}),e._uU(4,"click here"),e.qZA(),e._uU(5," or press Ctrl + S. "),e.qZA(),e.TgZ(6,"textarea",9),e._uU(7),e.qZA()()}if(2&o){const t=e.oxw();e.xp6(2),e.hij(" ",t.viewsLeft<=1?"This message has been destroyed":"Message "+(t.usePassword?"decrypted":"opened")+" successfully",". To stat a new message, "),e.xp6(5),e.Oqu(t.message)}}function v(o,c){if(1&o){const t=e.EpF();e.TgZ(0,"div",10)(1,"div",8),e._uU(2),e.TgZ(3,"a",6),e.NdJ("click",function(){e.CHM(t);const s=e.oxw();return e.KtG(s.navigateToCreate())}),e._uU(4,"click here"),e.qZA(),e._uU(5," or press Ctrl + S. "),e.qZA(),e._UZ(6,"div",11),e.qZA()}if(2&o){const t=e.oxw();e.xp6(2),e.hij(" ",t.viewsLeft<=1?"This message has been destroyed":"Message "+(t.usePassword?"decrypted":"opened")+" successfully",". This message cannot be copied. To stat a new message, "),e.xp6(4),e.Q6J("innerHTML",t.message,e.oJD)}}function _(o,c){if(1&o){const t=e.EpF();e.TgZ(0,"input",13),e.NdJ("ngModelChange",function(s){e.CHM(t);const i=e.oxw(2);return e.KtG(i.password=s)}),e.qZA()}if(2&o){const t=e.oxw(2);e.Q6J("ngModel",t.password)}}function x(o,c){if(1&o){const t=e.EpF();e.TgZ(0,"div",4)(1,"div",5)(2,"h3"),e._uU(3),e.qZA(),e.TgZ(4,"p"),e.YNc(5,_,1,1,"input",12),e.qZA(),e.TgZ(6,"a",6),e.NdJ("click",function(s){e.CHM(t);const i=e.oxw();return e.KtG(i.viewMessage(s))}),e._uU(7,"Click to View (Ctrl + V)"),e.qZA()()()}if(2&o){const t=e.oxw();e.xp6(3),e.hij(" You are trying to access a secret message. ",t.viewsLeft<=1?"This message will be destroyed after opening.":""," "),e.xp6(2),e.Q6J("ngIf",t.usePassword)}}function y(o,c){if(1&o){const t=e.EpF();e.TgZ(0,"div",4)(1,"div",5)(2,"h3"),e._uU(3," The secret message you are trying to access does not exist, or has expired. "),e.qZA(),e.TgZ(4,"p"),e._uU(5," Ctrl + S or "),e.TgZ(6,"a",6),e.NdJ("click",function(){e.CHM(t);const s=e.oxw();return e.KtG(s.navigateToCreate())}),e._uU(7,"click here"),e.qZA(),e._uU(8," to start a new message. "),e.qZA()()()}}const T=[{path:"",component:(()=>{class o{constructor(){this._activatedRoute=(0,e.f3M)(u.gz),this._messageService=(0,e.f3M)(f.e),this._router=(0,e.f3M)(u.F0),this.shortcuts=[],this.allowView=!1,this.showUnauthorized=!1,this.showError=!1,this.showMessage=!1,this.message="",this.viewsLeft=0,this.usePassword=!1,this.nocopy=!1,this.password="",this.messageId="",this.messageId=this._activatedRoute.snapshot.params.id,this._messageService.getMessageSnapshot(this.messageId).subscribe({next:t=>{this.viewsLeft=t.maxViews-t.views,this.usePassword=!!t.usePassword,this.nocopy=!!t.nocopy,this.allowView=!0},error:t=>{console.log(t),this.showUnauthorized=!0}})}navigateToCreate(){this._router.navigate(["/create"])}generateRandomString(t=2){let n="";let d=0;for(;d<t;)n+="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789~!@#$%^&*()-_=+[{]}|;:,./?".charAt(Math.floor(88*Math.random())),d+=1;return`<span class="obf">${n}</span>`}viewMessage(t){t&&t.preventDefault(),this._messageService.getMessageContent(this.messageId,this.password).subscribe({next:n=>{this.displayMessage(n.content)},error:n=>{"invalid_password"===n.error.type&&(alert("Invalid password."),location.reload()),console.log(n),this.showError=!0}})}displayMessage(t){if(!this.nocopy)return this.message=t,void(this.showMessage=!0);t=this.generateRandomString()+t.split("").map(n=>`<span class="nobf">${n}</span>`+this.generateRandomString()).join("").replaceAll("\n","<br>"),this.message=t,this.showMessage=!0}ngAfterViewInit(){var n,t=this;this.shortcuts.push({key:"ctrl + s",preventDefault:!0,allowIn:[a.Mv.Textarea,a.Mv.Input,a.Mv.ContentEditable,a.Mv.Select],command:(n=(0,g.Z)(function*(s){t.navigateToCreate()}),function(i){return n.apply(this,arguments)})},{key:"ctrl + v",preventDefault:!0,allowIn:[a.Mv.Textarea,a.Mv.Input,a.Mv.ContentEditable,a.Mv.Select],command:n=>{this.allowView&&this.viewMessage()}})}static#e=this.\u0275fac=function(n){return new(n||o)};static#t=this.\u0275cmp=e.Xpm({type:o,selectors:[["app-view"]],decls:6,vars:6,consts:[[3,"shortcuts"],["class","flex h-screen",4,"ngIf"],["class","h-full",4,"ngIf"],["class","h-full overflow-y-scroll",4,"ngIf"],[1,"flex","h-screen"],[1,"m-auto","text-center"],["href","#",1,"underline","mt-4",3,"click"],[1,"h-full"],[1,"w-full","bg-amber-700","text-white","text-center","px-8","py-2"],["autofocus","","spellcheck","false",1,"w-full","h-full","p-12","grow","border-none","outline-none","bg-transparent","resize-none",2,"max-width","100%"],[1,"h-full","overflow-y-scroll"],["autofocus","","spellcheck","false",1,"display-area","w-full","h-full","px-8","py-4","grow","bg-transparent",2,"max-width","100%",3,"innerHTML"],["type","password","autocomplete","off","autofocus","","class","bg-transparent text-center border-non border-b-2 border-gray-500 text-gray-500 placeholder-gray-500::placeholder pt-2 my-8 outline-none","placeholder","Password required",3,"ngModel","ngModelChange",4,"ngIf"],["type","password","autocomplete","off","autofocus","","placeholder","Password required",1,"bg-transparent","text-center","border-non","border-b-2","border-gray-500","text-gray-500","placeholder-gray-500::placeholder","pt-2","my-8","outline-none",3,"ngModel","ngModelChange"]],template:function(n,s){1&n&&(e._UZ(0,"ng-keyboard-shortcuts",0),e.YNc(1,w,9,0,"div",1),e.YNc(2,m,8,2,"div",2),e.YNc(3,v,7,2,"div",3),e.YNc(4,x,8,2,"div",1),e.YNc(5,y,9,0,"div",1)),2&n&&(e.Q6J("shortcuts",s.shortcuts),e.xp6(1),e.Q6J("ngIf",s.showError),e.xp6(1),e.Q6J("ngIf",s.allowView&&s.showMessage&&!s.nocopy),e.xp6(1),e.Q6J("ngIf",s.allowView&&s.showMessage&&s.nocopy),e.xp6(1),e.Q6J("ngIf",s.allowView&&!s.showMessage),e.xp6(1),e.Q6J("ngIf",s.showUnauthorized))},dependencies:[l.Fj,l.JJ,l.On,p.O5,a.xj],styles:["body{background:#2e2e2e;color:#fff;overflow:hidden}.display-area{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;outline:0}.display-area .obf{font-size:0px;width:0px;height:0px;color:transparent}\n"],encapsulation:2})}return o})()}];let M=(()=>{class o{static#e=this.\u0275fac=function(n){return new(n||o)};static#t=this.\u0275mod=e.oAB({type:o});static#s=this.\u0275inj=e.cJS({imports:[u.Bz.forChild(T),l.u5,p.ez,a.Ux.forRoot()]})}return o})()}}]);