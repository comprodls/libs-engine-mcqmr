/*
 * -------------
 * Engine Module
 * -------------
 * 
 * Item Type: MCQMR Single Choice Quesion engine
 * Code: MCQMR
 * Interface: ENGINE
 
 *  ENGINE Interface public functions
 *  {
 *          init(),
 *          getStatus(),
 *          getConfig()
 *  }
 * 
 *
 * This engine is designed to be loaded dynamical by other applications (or  platforms). At the starte the function [ engine.init() ] will be called  with necessary configuration paramters and a reference to platform "Adapter"  which allows subsequent communuication with the platform.
 *
 * The function [ engine.getStatus() ] may be called to check if SUBMIT has been pressed or not - the response from the engine is used to enable / disable appropriate platform controls.
 *
 * The function engine.getConfig() is called to request SIZE information - the response from the engine is used to resize & display the container iframe.
 *
 *
 * EXTERNAL JS DEPENDENCIES : ->
 * Following are shared/common dependencies and assumed to loaded via the platform. The engine code can use/reference these as needed
 * 1. JQuery (2.1.1)
 * 2. Boostrap (TODO: version) 
 */

define(['text!../html/mcqmr.html', //HTML layout(s) template (handlebars/rivets) representing the rendering UX
        'css!../css/mcqmr.css',  //Custom styles of the engine (applied over bootstrap & front-end-core)
        'rivets',  // Rivets for data binding
        'sightglass'], //Required by Rivets
        function (mcqmrTemplateRef) {

    mcqmr = function() {
    
    "use strict";
        
    /*
     * Reference to platform's activity adaptor (initialized during init() ).
     */
    var activityAdaptor;     
    
    /*
     * Internal Engine Config.
     */ 
    var __config = {
        MAX_RETRIES: 10, /* Maximum number of retries for sending results to platform for a particular activity. */ 
        RESIZE_MODE: "auto", /* Possible values - "manual"/"auto". Default value is "auto". */
        RESIZE_HEIGHT: "580" /* Applicable, if RESIZE_MODE is manual. If RESIZE_HEIGHT is defined in TOC then that will overrides. */
        /* If both config RESIZE_HEIGHT and TOC RESIZE_HEIGHT are not defined then RESIZE_MODE is set to "auto"*/
    };
    
    /*
     * Internal Engine State.
     */ 
    var __state = {
        currentTries: 0, /* Current try of sending results to platform */
        activityPariallySubmitted: false, /* State whether activity has been partially submitted. Possible Values: true/false(Boolean) */
        activitySubmitted: false, /* State whether activity has been submitted. Possible Values: true/false(Boolean) */
        checkBoxClicked: [] /* State whether radio button is clicked.  Possible Values: true/false(Boolean) */   
    };  
    
    /*
     * Content (loaded / initialized during init() ).
     */ 
    var __content = {
        directionsJSON: "",
        questionsJSON: [], /* Contains the question obtained from content JSON. */
        optionsJSON: [], /* Contains all the options for a particular question obtained from content JSON. */
        answersJSON: [], /* Contains the answer for a particular question obtained from content JSON. */
        userAnswersJSON: [], /* Contains the user answer for a particular question. */
        activityType: null,  /* Type of FIB activity. Possible Values :- FIBPassage.  */ 
        scoreJSON : null,
        feedbackJSON : null
    };

    /*
     * Constants.
     */
    var __constants = {
        /* CONSTANT for PLATFORM Save Status NO ERROR */
        STATUS_NOERROR: "NO_ERROR",
        TEMPLATES: {
            /* Regular MCQMR Layout */
            MCQMR: mcqmrTemplateRef
        }
    };
    // Array of all interaction tags in question
    var __interactionIds = [];
    var __processedJsonContent;
    var __feedback = {
        'correct' : false,
        'incorrect' : false,
        'empty' : false
    };
        
    /********************************************************/
    /*                  ENGINE-SHELL INIT FUNCTION
        
        "elRoot" :->        DOM Element reference where the engine should paint itself.                                                     
        "params" :->        Startup params passed by platform. Include the following sets of parameters:
                        (a) State (Initial launch / Resume / Gradebook mode ).
                        (b) TOC parameters (videoRoot, contentFile, keyframe, layout, etc.).
        "adaptor" :->        An adaptor interface for communication with platform (__saveResults, closeActivity, savePartialResults, getLastResults, etc.).
        "htmlLayout" :->    Activity HTML layout (as defined in the TOC LINK paramter). 
        "jsonContent" :->    Activity JSON content (as defined in the TOC LINK paramter).
        "callback" :->      To inform the shell that init is complete.
    */
    /********************************************************/  
    function init(elRoot, params, adaptor, htmlLayout, jsonContentObj, callback) {      
        console.log("Welcome to the init world! ++++++++++++++++++++++++++++");  

        /* ---------------------- BEGIN OF INIT ---------------------------------*/
        //Store the adaptor  
        activityAdaptor = adaptor;

        //Clone the JSON so that original is preserved.
        var jsonContent = jQuery.extend(true, {}, jsonContentObj);
        
        console.log(jsonContent);
        /* ------ VALIDATION BLOCK START -------- */    
        if (jsonContent.content === undefined) {
            if(callback) {
                callback();
            }       
            //TODO - In future more advanced schema validations could be done here        
            return; /* -- EXITING --*/
        }
        
        /* ------ VALIDATION BLOCK END -------- */        
        
        /* Parse and update content JSON. */
        __processedJsonContent = __parseAndUpdateJSONContent(jsonContent, params, htmlLayout);
        //Process JSON for easy iteration in template
        //__parseAndUpdateJSONForRivets();
        __parseAndUpdateJSONForRivets(__processedJsonContent);

        /* Apply the layout HTML to the dom */
        $(elRoot).html(__constants.TEMPLATES[htmlLayout]);

        /* Initialize RIVET. */
        __initRivets();
        /* ---------------------- SETUP EVENTHANDLER STARTS----------------------------*/
            
       // $('input[id^=option]').change(__handleRadioButtonClick); 
       
       $('input[id^=option]').change(__handleCheckboxClick); 

        $(document).bind('userAnswered', function() {
            __saveResults(false);
        });

        /* ---------------------- SETUP EVENTHANDLER ENDS------------------------------*/

        /* Inform the shell that init is complete */
        if(callback) {
            callback();
        }                               
        
        /* ---------------------- END OF INIT ---------------------------------*/
    } /* init() Ends. */        
    /* ---------------------- PUBLIC FUNCTIONS --------------------------------*/
    /**
     * ENGINE-SHELL Interface
     *
     * Return configuration
     */
    function getConfig () {
        return __config;
    }
    
    /**
     * ENGINE-SHELL Interface
     *
     * Return the current state (Activity Submitted/ Partial Save State.) of activity.
     */
    function getStatus() {
        return __state.activitySubmitted || __state.activityPariallySubmitted;
    }
    
    /**
    * Bound to click of Activity submit button.
    */
    function handleSubmit(event){
        /* Saving Answer. */
        __saveResults(true);

        /* Marking Answers. */
        if (activityAdaptor.showAnswers) {
            __markAnswers();
        }

        $('input[id^=option]').attr("disabled", true);
    }

    /**
    * Function to show user grades.
    */
    function showGrades(savedAnswer, reviewAttempt){
        /* Show last saved answers. */
        updateLastSavedResults(savedAnswer);
        /* Mark answers. */
        __markAnswers();
        $('input[id^=option]').attr("disabled", true);      
    } 

    /**
     * Function to display last result saved in LMS.
     */ 
    function updateLastSavedResults(lastResults) {
        $.each(lastResults.results, function(num) {
            __content.userAnswersJSON[num] = this.answer.trim();
            for(var i = 0; i < $('input[id^=option]').length; i++) {
                if($('input[id^=option]')[i].value.trim() === this.answer.trim()) {
                    $('input[id^=option]')[i].checked = true;
                    break;
                }
            }
        });
    }
    /* ---------------------- PUBLIC FUNCTIONS END ----------------------------*/
     

    /* ---------------------- PRIVATE FUNCTIONS -------------------------------*/

     /* ---------------------- JSON PROCESSING FUNCTIONS START ---------------------------------*/
     /**
     * Parse and Update JSON based on MCQMR specific requirements.
     */
    function __parseAndUpdateJSONContent(jsonContent, params, htmlLayout) { 
        jsonContent.content.displaySubmit = activityAdaptor.displaySubmit;   
        
        __content.activityType = params.engineType;
        __content.layoutType = jsonContent.content.canvas.layout;

        /* Activity Instructions. */
        var tagName = jsonContent.content.instructions[0].tag;
        __content.directionsJSON = jsonContent.content.instructions[0][tagName];
        /* Put directions in JSON. */
        jsonContent.content.directions = __content.directionsJSON;
        $.each(jsonContent.content.stimulus, function(i) {
            if(this.tag === "image") {
                jsonContent.content.stimulus.mediaContent = params.questionMediaBasePath + this.image;
            }
        });    
        __content.scoreJSON = jsonContent.meta.score;
        __content.feedbackJSON = jsonContent.feedback; 
        console.log(__content.feedbackJSON) ;      
        __parseAndUpdateQuestionSetTypeJSON(jsonContent);
        
        /* Returning processed JSON. */
        console.log("contyent obj ",__content);
        return jsonContent; 
    }

    
    /**
     * Parse and Update Question Set type JSON based on  MCQMR specific requirements.
     */  
    function __parseAndUpdateQuestionSetTypeJSON(jsonContent) {

        /* Extract interaction id's and tags from question text. */
        var interactionId = "";
        var interactionTag = "";
        /* String present in href of interaction tag. */
        var interactionReferenceString = "http://www.comprodls.com/m1.0/interaction/mcqmr";
        /* Parse questiontext as HTML to get HTML tags. */
        var parsedQuestionArray = $.parseHTML(jsonContent.content.canvas.data.questiondata[0].text);
        $.each( parsedQuestionArray, function(i, el) {
          if(this.href === interactionReferenceString) {
            interactionId = this.childNodes[0].nodeValue.trim();
            __interactionIds.push(interactionId);
            interactionTag = this.outerHTML;
            interactionTag = interactionTag.replace(/"/g, "'");
          }
        });
        /* Replace interaction tag with blank string. */
        jsonContent.content.canvas.data.questiondata[0].text = jsonContent.content.canvas.data.questiondata[0].text.replace(interactionTag,"");
        var questionText = "1.  " + jsonContent.content.canvas.data.questiondata[0].text;
        var correctAnswerNumber = jsonContent.responses[interactionId].correct;
        console.log("correct answers : ", correctAnswerNumber);
        var interactionType = jsonContent.content.interactions[interactionId].type;
        var optionCount = jsonContent.content.interactions[interactionId][interactionType].length;

        /* Make optionsJSON and answerJSON from JSON. */
        for(var i = 0; i < optionCount; i++) {
            var optionObject = jsonContent.content.interactions[interactionId][interactionType][i];
            var option = optionObject[Object.keys(optionObject)].replace(/^\s+|\s+$/g, '');
            __content.optionsJSON.push(__getHTMLEscapeValue(option));
            optionObject[Object.keys(optionObject)] = option;
            /* Update JSON after updating option. */
            jsonContent.content.interactions[interactionId][interactionType][i] = optionObject;
           // if(Object.keys(optionObject) == correctAnswerNumber) {
                __content.answersJSON = correctAnswerNumber;
           // }
        }
        __content.questionsJSON[0] = questionText + " ^^ " + __content.optionsJSON.toString() + " ^^ " + interactionId;       

    }
    
    /**
     * Escaping HTML codes from String.
     */
    function __getHTMLEscapeValue(content) {  
        var tempDiv = $("<div></div>");
        $(tempDiv).html(content);
        $("body").append(tempDiv);
        content  = $(tempDiv).html();
        $(tempDiv).remove();    
        return content;
    }      

    /***
     * Function to modify question JSON for easy iteration in template
     * 
     * Original JSON Object
     * ---------------------
     * 
     * "MCQMR": [
          {
            "choiceA": "She has the flu." 
          },
          {
            "choiceB": "She has the measles."
          }  
        ]

        Modified JSON Object
        ----------------------

        "MCQMR": [
          {
              "customAttribs" : {
                    "key" : "choiceA",
                    "value" : "She has the flu.",
                    "isEdited" : false,
                    "index" : 0
                    "isCorrect" : false
              } 
          },
           {
              "customAttribs" : {
                    "key" : "choiceB",
                    "value" : "She has the measles.",
                    "isEdited" : false,
                    "index" : 1
                    "isCorrect" : true
              } 
          }  
        ]
     */
    function __parseAndUpdateJSONForRivets(jsonContent){  
       var processedArray = [];
       for(var i=0; i <__interactionIds.length; i++){
            jsonContent.content.interactions[__interactionIds[i]].MCQMR.forEach(function(obj, index){
                var processedObj = {};
                processedObj.customAttribs = {};
                Object.keys(obj).forEach(function(key){
                    processedObj.customAttribs.key = key;
                    processedObj.customAttribs.value = obj[key];
                });
                processedArray.push(processedObj);
            });
            jsonContent.content.interactions[__interactionIds[i]].MCQMR = processedArray;  
       }
    } 

    /*------------------------RIVET INITIALIZATION & BINDINGS -------------------------------*/        
    function __initRivets(){
        /* Formatter to transform object into object having 'key' property with value key
         * and 'value' with the value of the object
         * Example:
         * var obj = {'choiceA' : 'She has flu.'} to
         * obj= { 'key' : 'choiceA', 'value' : 'She has flu.'}
         * This is done to access the key and value of object in the template using rivets.
         */
        rivets.formatters.propertyList = function(obj) {
          return (function() {
            var properties = [];
            for (var key in obj) {
              properties.push({key: key, value: obj[key]})
            }
            return properties
          })();
        }

        /* This formatter is used to append interaction property to the object
         * and return text of the question for particular interaction
         */
        rivets.formatters.appendInteraction = function(obj, interaction, MCQMR){
            return obj[interaction].text;
        }

        /* This formatter is used to return the array of options for a particular
         * interaction so that rivets can iterate over it.
         */
        rivets.formatters.getArray = function(obj, interaction){ 
            console.log("interactions ", interaction);
                       return obj[interaction].MCQMR;
        }

         /* This formatter is used to return  customized  indexed base string
         */
        rivets.formatters.idcreator = function(index, idvalue) {
          return idvalue + index;
        }

        var isMCQImageEngine = false;
        /* Find if layout is of type MCQ_IMG*/
        if(__content.layoutType == 'MCQMR_IMG'){
            isMCQImageEngine = true;
        }

        /*Bind the data to template using rivets*/
        rivets.bind($('#mcqmr-engine'), {
            content: __processedJsonContent.content,
            isMCQImageEngine: isMCQImageEngine,
            feedback : __processedJsonContent.feedback,
            showFeedback : __feedback
        });
    }

    /*------------------------RIVETS END-------------------------------*/

    /* ---------------------- JQUERY BINDINGS ---------------------------------*/
    /**
    * Function to handle radio button click.
    */
    function __handleCheckboxClick(event){
       // alert("  I m clicked ");
        var currentTarget = event.currentTarget;
        var currentchoice = currentTarget.getAttribute('name'); 
        // if current choice checked
        if(currentTarget.checked) {
            __content.userAnswersJSON.push(currentTarget.getAttribute('name'));  
            alert(JSON.stringify(__content.userAnswersJSON, null, 4))          
        } else {
           
            remove(__content.userAnswersJSON, currentTarget.getAttribute('name')); 
            alert(JSON.stringify(__content.userAnswersJSON, null, 4))   
        }
        // then addd
        // else remove from user answer
        $(document).triggerHandler('userAnswered');
    }

    function remove(arr, value) {
        var found = arr.indexOf(value);
        if (found !== -1) {
            arr.splice(found, 1);
        //    found = arr.indexOf(value);
        }
    }


    /*------------------------RIVETS END-------------------------------*/

    /* ---------------------- JQUERY BINDINGS ---------------------------------*/
    /**
    * Function to handle radio button click.
    */
    function __handleRadioButtonClick(event){
        /*
         * Soft save here
         */
        alert("  I m clicked ");
        var currentTarget = event.currentTarget;
        
        //$("label.radio").parent().removeClass("highlight");
        //$(currentTarget).parent().parent("li").addClass("highlight");  
        
        var newAnswer = currentTarget.value.replace(/^\s+|\s+$/g, '');
            
        /* Save new Answer in memory. */
        __content.userAnswersJSON[0] = newAnswer.replace(/^\s+|\s+$/g, '');  
        
        __state.checkBoxClicked = true;
        
        var interactionId = __content.questionsJSON[0].split("^^")[2].trim();

        $(document).triggerHandler('userAnswered');
    }   

    /**
     * Function called to send result JSON to adaptor (partial save OR submit).
     * Parameters:
     * 1. bSumbit (Boolean): true: for Submit, false: for Partial Save.
     */
    function __saveResults(bSubmit){
        
        var uniqueId = activityAdaptor.getId(); 

        /*Getting answer in JSON format*/
        var answerJSON = __getAnswersJSON(false);

        if(bSubmit===true) {/*Hard Submit*/

            /*Send Results to platform*/
            activityAdaptor.submitResults(answerJSON, uniqueId, function(data, status){
                if(status=== __constants.STATUS_NOERROR){
                    __state.activitySubmitted = true;
                    /*Close platform's session*/
                    activityAdaptor.closeActivity();
                    __state.currentTries = 0;
                } else {
                    /* There was an error during platform communication, so try again (till MAX_RETRIES) */             
                    if(__state.currentTries < __config.MAX_RETRIES) {
                        __state.currentTries++ ;
                        __saveResults(bSubmit);
                    }

                }

            });
        } else{ /*Soft Submit*/
            /*Send Results to platform*/
            activityAdaptor.savePartialResults(answerJSON, uniqueId, function(data, status){
                if(status=== __constants.STATUS_NOERROR){
                    __state.activityPariallySubmitted = true;
                } else {
                    /* There was an error during platform communication, do nothing for partial saves */
                }
            });
        }
    }    

    /*------------------------OTHER PRIVATE FUNCTIONS------------------------*/

    /**
     * Function to show correct Answers to User, called on click of Show Answers Button.
     */ 
    function __markAnswers(){
           __markCheckBox();
           __generateFeedback();
    }

    /* Add correct or wrong answer classes*/
    function __markCheckBox() {    
       for(var j=0;j<__content.answersJSON.length;j++) {
           $("[id^=answer]").removeClass("invisible");
           for(var j=0;j<__content.answersJSON.length;j++){
                $("input[name='"+__content.answersJSON[j]+"']").prev('span').removeClass("wrong")    
                $("input[name='"+__content.answersJSON[j]+"']").prev('span').removeClass("state-error")
                $("input[name='"+__content.answersJSON[j]+"']").prev('span').addClass("correct")
                $("input[name='"+__content.answersJSON[j]+"']").prev('span').addClass("state-success")
           }

       }
    }

    function __generateFeedback() {
    //    __feedback.incorrect = true;
         for(var prop in __feedback){
            __feedback[prop] = false;
        }
        if(__content.userAnswersJSON.length <= 0){
            __feedback.empty = true;
        } else if(isCorrect(__content.answersJSON , __content.userAnswersJSON)){
            __feedback.correct = true;
        } else{
            __feedback.incorrect = true;
        }

        function isCorrect(answerjson, useranswerjson) {
            var isCorrect = false;
            if (answerjson == null || useranswerjson == null) return isCorrect = false;
            if(answerjson.length != useranswerjson.length){
                return isCorrect=false;
            }
            if(answerjson.sort().join("") === useranswerjson.sort().join("")) return isCorrect = true;;
            return isCorrect;
        }
     
    }
    
    /**
     *  Function used to create JSON from user Answers for submit(soft/hard).
     *  Called by :-
     *   1. __saveResults (internal).
     *   2. Multi-item-handler (external).
     */  
    function __getAnswersJSON(skipQuestion){

        var score = __content.scoreJSON.default || 0;
        var maxscore = __content.scoreJSON.max || 1;
        var answer = "";
        var results = {};
        var correct = true;
        
        /*Setup results array */
        var resultArray = new Array(1);
        /* Split questionJSON to get interactionId. */
        var questionData = __content.questionsJSON[0].split("^^");
        var interactionId = questionData[2].trim();
        if (skipQuestion) {
            answer = "Not Answered";
        } else {
            var flag = true;
            answer = __content.userAnswersJSON;
            if(__content.answersJSON.length === __content.userAnswersJSON.length){
                for(var i=0; i < __content.answersJSON.length; i++) {
                    if($.inArray(__content.userAnswersJSON[i], __content.answersJSON) === -1) {
                        flag = false;
                        break;
                    }
                }
                if(flag === true) {
                    score += maxscore;
                } else {
					correct = false;
                }
            }

        }   
        
        results = {
            itemUID: interactionId,
            answer: answer,           
            score: score
           
        };
        resultArray[0] = results;

        return {
            "results": resultArray
        };    
    }   
    
    return {
        /*Engine-Shell Interface*/
        "init": init, /* Shell requests the engine intialized and render itself. */
        "getStatus": getStatus, /* Shell requests a gradebook status from engine, based on its current state. */
        "getConfig" : getConfig, /* Shell requests a engines config settings.  */
        "handleSubmit" : handleSubmit,
        "showGrades": showGrades,
        "updateLastSavedResults": updateLastSavedResults
    };
    };
});



