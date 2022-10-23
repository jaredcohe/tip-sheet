// Main runner for Tips Sheet
function createTipsSheet() {
    var properties = PropertiesService.getScriptProperties();
    var squareAccessToken = properties.getProperty('square_access_token');
    var fullAccessToken = 'Bearer ' + squareAccessToken;

    var sheetObject = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Automated Tips Sheet");
    var locationId = sheetObject.getRange(8, 2, 1, 1).getValues()[0][0];
    var [startDate, endDate] = getDatesForTipsSheet(sheetObject);

    // Tip amounts
        // Get total tip amounts from manual entry into the sheet
        // Or pull credit card tips from Square if possible
        var orders = getAndCombineOrdersData(startDate, endDate, locationId, fullAccessToken);
        Logger.log(orders);
        Logger.log("Orders count = " + orders.length);
        var totalTips = 0;
        orders.forEach(function (order) {
            totalTips = totalTips + order["total_tip_money"]["amount"];
        });
        Logger.log("totalTips = " + totalTips);

        // Clear and write total credit card tips
        sheetObject.getRange(2, 2, 1, 1).clearContent().setValue(totalTips / 100);
    // END Tip Amounts

    // Get shifts/hours from square
    var shifts = getShiftsFromSquare(startDate, endDate, locationId, fullAccessToken);
    // Logger.log(startDate);
    // Logger.log(endDate);
    // Logger.log(shifts);
    // Logger.log(shifts[0]);
    Logger.log("Shifts count = " + shifts.length);

    // Get all team members list from Square
    var employees = getAllEmployeeDataFromSquare(fullAccessToken);
    // Logger.log(employees);
    // Logger.log(employees[0]);
    Logger.log("Employees count = " + employees.length);

    // Create the rows of data, including combining team member data with shifts data by looping through team based on team_member_id
    // Loop through shifts, and if it's a tipped role based on title matching a tipped role, then put it in the list
    var listOfTipSheetEntries = [];
    var tipPoolRulesSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Tip Pool Rules");    
    var sheetObjectLastRow = tipPoolRulesSheet.getLastRow();
    var listOfTippedRolesArrayOfArrays = tipPoolRulesSheet.getRange(7, 1, sheetObjectLastRow-6, 1).getValues();
    var listOfTippedRolesArray = [];
    var employeeFirstName;
    var employeeLastName;

    listOfTippedRolesArrayOfArrays.forEach(function (role) {
        listOfTippedRolesArray.push(role[0].toLowerCase());
    });

    var shiftTitle;
    var shiftTitleLowerCase;
    shifts.forEach(function (shift) {

        // Loop through employees and add first and last name if the employee ID matches
        employees.forEach(function (employee) {
            if (shift["employee_id"] == employee["id"]) {
                employeeFirstName = employee["given_name"];
                employeeLastName = employee["family_name"];
            }

        });

        shiftTitle = shift["wage"]["title"]
        shiftTitleLowerCase = shift["wage"]["title"].toLowerCase()
        // if the shift title is in the list of titles for tipped roles then add it to the list of tip sheet entries
        if (listOfTippedRolesArray.includes(shiftTitleLowerCase)) {
            listOfTipSheetEntries.push([employeeLastName, employeeFirstName, shiftTitle, (Math.round(((Date.parse(shift["end_at"]) - Date.parse(shift["start_at"])) / 36e5) * 100)) / 100]);
        };
    });
    Logger.log(listOfTipSheetEntries);

    // Clear and write the rows of data
    sheetObject.getRange(12, 1, 30, 4).clearContent();
    sheetObject.getRange(12, 1, listOfTipSheetEntries.length, 4).setValues(listOfTipSheetEntries);
}

function getDatesForTipsSheet(sheetObject) {
    var date = sheetObject.getRange(1, 2).getValues()[0][0];
    var dayAfter = date.getDate() + 1;
    var nowFormatted = date.toISOString(); //RFC 3339 format
    var startDate = nowFormatted.replace(/\d+:\d+:\d+/, "09:00:00");
    var dayTwoDigit = dayAfter > 10 ? dayAfter + "T" : "0" + dayAfter.toString() + "T";
    var endDate = startDate.replace(/\d{2}T/, dayTwoDigit);
    return [startDate, endDate];
}

// https://developer.squareup.com/explorer/square/team-api/search-team-members
function getAllEmployeeDataFromSquare(fullAccessToken) {
    var data = {
        "limit" : 200
    }

    var options = {
      'method' : 'post',
      'contentType': 'application/json',
      'headers' : { 'Square-Version' : '2022-10-19', 'Authorization' : fullAccessToken },
      'payload' : JSON.stringify(data)
    };

    var response = UrlFetchApp.fetch('https://connect.squareup.com/v2/team-members/search', options);
    return JSON.parse(response.getContentText())["team_members"];
}

// https://developer.squareup.com/explorer/square/labor-api/search-shifts
function getShiftsFromSquare(startDate, endDate, locationId, fullAccessToken) {
    var data = {
      "query" : {
          "filter": {
              "location_ids": [
                locationId
              ],
              "start": {
                  "start_at": startDate,
                  "end_at": endDate
              }
          }
      },
      "limit": 200
    }

    var options = {
      'method' : 'post',
      'contentType': 'application/json',
      'headers' : { 'Square-Version' : '2022-10-19', 'Authorization' : fullAccessToken },
      // Convert the JavaScript object to a JSON string.
      'payload' : JSON.stringify(data)
    };

    var response = UrlFetchApp.fetch('https://connect.squareup.com/v2/labor/shifts/search', options);
    return JSON.parse(response.getContentText())["shifts"];
};

function getOrdersFromDay(startDate, endDate, locationId, cursor, fullAccessToken) {
    var data = {
      "query" : {
          "filter": {
              "date_time_filter": {
                  "created_at": {
                    "start_at": startDate,
                    "end_at": endDate
                  }
              },
              "state_filter": {
                "states": [
                  "COMPLETED", "CANCELED"
                ]
              }
          },
          "sort": {
            "sort_field": "CREATED_AT",
            "sort_order": "DESC"
          }
      },
      "location_ids": [
          locationId
      ],
      "limit": 500,
      "cursor" : cursor
    }

    var options = {
      'method' : 'post',
      'contentType': 'application/json',
      'headers' : { 'Square-Version' : '2022-10-19', 'Authorization' : fullAccessToken },
      // Convert the JavaScript object to a JSON string.
      'payload' : JSON.stringify(data)
    };

    var response = UrlFetchApp.fetch('https://connect.squareup.com/v2/orders/search', options);
    var parsedResponse = JSON.parse(response);
    return parsedResponse;

    /*
    Logger.log(JSON.parse(response.getContentText()));
    Logger.log(JSON.parse(response.getContentText())["orders"]);
    Logger.log(JSON.parse(response.getContentText())["orders"].length);
    Logger.log(JSON.parse(response.getContentText())["orders"][2]);
    Logger.log(JSON.parse(response.getContentText())["orders"][2]["total_tip_money"]["amount"]); // in cents
    Logger.log("RESPONSE");
    Logger.log(JSON.parse(response));
    Logger.log(JSON.parse(response)["cursor"]);
    Logger.log(JSON.parse(response)["orders"]);
    Logger.log("Order 3 = ");
    Logger.log(JSON.parse(response.getContentText())["orders"][3]);
    Logger.log("Order 266 = ");
    Logger.log(JSON.parse(response.getContentText())["orders"][266]);
    */

};

function getAndCombineOrdersData(startDate, endDate, locationId, fullAccessToken) {
    var orders = [];
    var response = getOrdersFromDay(startDate, endDate, locationId, '', fullAccessToken);
    var newOrders = response["orders"];
    var cursor = response["cursor"];
    orders = orders.concat(newOrders);

    while (cursor) {
        response = getOrdersFromDay(startDate, endDate, locationId, cursor, fullAccessToken);
        newOrders = response["orders"];
        cursor = response["cursor"];
        orders = orders.concat(newOrders);
        Logger.log(orders.length)
    }

    return orders;

    /*
    var cursor = JSON.parse(response)["cursor"];
    var newOrders = JSON.parse(response)["orders"];
    
    Logger.log("Orders length = " + orders.length);

    if (cursor) {
        Logger.log("CURSORRRRR");
        // add to orders array and call it again
        getOrdersFromDay(startDate, endDate, locationId, cursor, orders);
    } else {
        Logger.log("NOOOO CURSORRRRR");
        // add to orders array and return
        Logger.log("Returning orders on next line = ");
        Logger.log(orders);
        Logger.log("Orders length = " + orders.length);
        return orders;
    };
    */

}
